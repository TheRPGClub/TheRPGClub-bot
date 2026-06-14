import axios from "axios";
import crypto from "node:crypto";
import { sleep } from "../utilities/DelayUtils.js";
import { logWarn } from "../utilities/LogUtils.js";

const BACKBLAZE_AUTH_URL = "https://api.backblazeb2.com/b2api/v2/b2_authorize_account";

type BackblazeB2AuthPayload = {
  accountId: string;
  authorizationToken: string;
  apiUrl: string;
  downloadUrl: string;
  recommendedPartSize: number;
  absoluteMinimumPartSize: number;
};

type BackblazeB2AuthResponse = {
  accountId?: string;
  authorizationToken?: string;
  apiUrl?: string;
  downloadUrl?: string;
  recommendedPartSize?: number;
  absoluteMinimumPartSize?: number;
  apiInfo?: {
    storageApi?: {
      apiUrl?: string;
      downloadUrl?: string;
      recommendedPartSize?: number;
      absoluteMinimumPartSize?: number;
    };
  };
};

type BackblazeB2UploadUrlResponse = {
  authorizationToken: string;
  uploadUrl: string;
};

type BackblazeB2UploadResponse = {
  fileId: string;
  fileName: string;
};

type BackblazeB2ListFileNamesResponse = {
  files: Array<{
    fileId: string;
    fileName: string;
    fileInfo?: Record<string, string>;
  }>;
  nextFileName?: string | null;
};

type BackblazeB2DownloadAuthorizationResponse = {
  authorizationToken: string;
};

type BackblazeStoredFileInfo = {
  fileId: string;
  fileName: string;
  sourceHash: string | null;
};

type BackblazeUploadInput = {
  bucketId: string;
  fileName: string;
  contentType: string;
  data: Buffer;
  sourceHash?: string;
};

type BackblazeUploadResult = {
  fileId: string;
  fileName: string;
};

let cachedAuth: { value: BackblazeB2AuthPayload; expiresAtMs: number } | null = null;

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as Record<string, unknown>).code;
  const status = (error as { response?: { status?: number } }).response?.status;
  if (typeof code === "string" && ["ECONNRESET", "ETIMEDOUT", "ECONNABORTED"].includes(code)) {
    return true;
  }
  if (typeof status === "number" && (status === 429 || status >= 500)) return true;
  const message = (error as { message?: string }).message ?? "";
  return message.toLowerCase().includes("socket hang up");
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt === RETRY_MAX_ATTEMPTS) throw error;
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      logWarn("BackblazeB2Service.retry", `${label} failed (attempt ${attempt}/${RETRY_MAX_ATTEMPTS}), retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
  throw lastError;
}

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Backblaze B2 is not configured. Missing environment variable: ${name}`);
  }
  return value;
}

export function hasBackblazeB2Config(): boolean {
  return Boolean(
    (process.env.BACKBLAZE_B2_KEY_ID ?? "").trim() &&
    (process.env.BACKBLAZE_B2_APPLICATION_KEY ?? "").trim() &&
    (process.env.BACKBLAZE_B2_BUCKET_ID ?? "").trim() &&
    (process.env.BACKBLAZE_B2_BUCKET_NAME ?? "").trim(),
  );
}

export async function authorizeBackblazeB2(): Promise<BackblazeB2AuthPayload> {
  const now = Date.now();
  if (cachedAuth && cachedAuth.expiresAtMs > now) {
    return cachedAuth.value;
  }

  const keyId = getRequiredEnv("BACKBLAZE_B2_KEY_ID");
  const applicationKey = getRequiredEnv("BACKBLAZE_B2_APPLICATION_KEY");
  const auth = Buffer.from(`${keyId}:${applicationKey}`, "utf8").toString("base64");

  const response = await axios.get<BackblazeB2AuthResponse>(BACKBLAZE_AUTH_URL, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

  const data = response.data;
  const apiUrl = data.apiUrl ?? data.apiInfo?.storageApi?.apiUrl ?? "";
  const downloadUrl = data.downloadUrl ?? data.apiInfo?.storageApi?.downloadUrl ?? "";
  const recommendedPartSize =
    data.recommendedPartSize ?? data.apiInfo?.storageApi?.recommendedPartSize ?? 0;
  const absoluteMinimumPartSize =
    data.absoluteMinimumPartSize ?? data.apiInfo?.storageApi?.absoluteMinimumPartSize ?? 0;

  if (!data.accountId || !data.authorizationToken || !apiUrl || !downloadUrl) {
    throw new Error(
      "Backblaze B2 authorization response is missing required fields. " +
      "Confirm credentials and API compatibility.",
    );
  }

  const payload = {
    accountId: data.accountId,
    authorizationToken: data.authorizationToken,
    apiUrl,
    downloadUrl,
    recommendedPartSize,
    absoluteMinimumPartSize,
  };

  cachedAuth = {
    value: payload,
    expiresAtMs: now + (23 * 60 * 60 * 1000),
  };
  return payload;
}

export async function testBackblazeB2Connection(): Promise<boolean> {
  await authorizeBackblazeB2();
  return true;
}

export function getBackblazeBucketConfig(): { bucketId: string; bucketName: string } {
  return {
    bucketId: getRequiredEnv("BACKBLAZE_B2_BUCKET_ID"),
    bucketName: getRequiredEnv("BACKBLAZE_B2_BUCKET_NAME"),
  };
}

function isBackblazeBucketPublic(): boolean {
  return (process.env.BACKBLAZE_B2_BUCKET_PUBLIC ?? "").trim().toLowerCase() === "true";
}

export function sha256Hex(value: Buffer | string): string {
  // eslint-disable-next-line local/no-direct-interaction-response-methods
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function getUploadUrl(bucketId: string): Promise<BackblazeB2UploadUrlResponse> {
  const auth = await authorizeBackblazeB2();
  const response = await axios.post<BackblazeB2UploadUrlResponse>(
    `${auth.apiUrl}/b2api/v2/b2_get_upload_url`,
    { bucketId },
    {
      headers: {
        Authorization: auth.authorizationToken,
      },
    },
  );
  return response.data;
}

export async function getLatestStoredFileInfo(
  bucketId: string,
  fileName: string,
): Promise<BackblazeStoredFileInfo | null> {
  const auth = await authorizeBackblazeB2();
  const response = await axios.post<BackblazeB2ListFileNamesResponse>(
    `${auth.apiUrl}/b2api/v2/b2_list_file_names`,
    {
      bucketId,
      maxFileCount: 1,
      prefix: fileName,
      startFileName: fileName,
    },
    {
      headers: {
        Authorization: auth.authorizationToken,
      },
    },
  );
  const file = response.data.files.find((entry) => entry.fileName === fileName);
  if (!file) {
    return null;
  }
  return {
    fileId: file.fileId,
    fileName: file.fileName,
    sourceHash: file.fileInfo?.sourcehash ?? null,
  };
}

export async function uploadFileToBackblazeB2(
  input: BackblazeUploadInput,
): Promise<BackblazeUploadResult> {
  // eslint-disable-next-line local/no-direct-interaction-response-methods
  const fileSha1 = crypto.createHash("sha1").update(input.data).digest("hex");

  return withRetry(async () => {
    const upload = await getUploadUrl(input.bucketId);
    const headers: Record<string, string> = {
      Authorization: upload.authorizationToken,
      "X-Bz-File-Name": encodeURIComponent(input.fileName),
      "Content-Type": input.contentType,
      "Content-Length": String(input.data.length),
      "X-Bz-Content-Sha1": fileSha1,
    };
    if (input.sourceHash) {
      headers["X-Bz-Info-sourcehash"] = input.sourceHash;
    }

    const response = await axios.post<BackblazeB2UploadResponse>(
      upload.uploadUrl,
      input.data,
      {
        headers,
        maxBodyLength: Infinity,
      },
    );

    return {
      fileId: response.data.fileId,
      fileName: response.data.fileName,
    };
  }, `upload ${input.fileName}`);
}

export async function getOrReplaceBackblazeImage(
  identifierKey: string,
  sourceHash: string,
  render: () => Promise<Buffer>,
): Promise<{ fileName: string; url: string; changed: boolean }> {
  const safeKey = identifierKey.replace(/[^a-zA-Z0-9/_-]/g, "_").replace(/\/+/g, "/");
  const { bucketId, bucketName } = getBackblazeBucketConfig();
  const auth = await authorizeBackblazeB2();
  const fileName = `${safeKey}.png`;

  const existing = await getLatestStoredFileInfo(bucketId, fileName);
  if (existing?.sourceHash === sourceHash) {
    const url = await buildBackblazeDownloadUrl(
      auth.downloadUrl,
      bucketId,
      bucketName,
      fileName,
      sourceHash,
    );
    return {
      fileName,
      url,
      changed: false,
    };
  }

  const imageBuffer = await render();
  await uploadFileToBackblazeB2({
    bucketId,
    fileName,
    contentType: "image/png",
    data: imageBuffer,
    sourceHash,
  });
  const url = await buildBackblazeDownloadUrl(
    auth.downloadUrl,
    bucketId,
    bucketName,
    fileName,
    sourceHash,
  );
  return {
    fileName,
    url,
    changed: true,
  };
}

async function buildBackblazeDownloadUrl(
  downloadUrl: string,
  bucketId: string,
  bucketName: string,
  fileName: string,
  sourceHash: string,
): Promise<string> {
  const baseUrl = `${downloadUrl}/file/${bucketName}/${fileName}`;
  if (isBackblazeBucketPublic()) {
    return `${baseUrl}?v=${encodeURIComponent(sourceHash)}`;
  }

  const auth = await authorizeBackblazeB2();
  const tokenResponse = await axios.post<BackblazeB2DownloadAuthorizationResponse>(
    `${auth.apiUrl}/b2api/v2/b2_get_download_authorization`,
    {
      bucketId,
      fileNamePrefix: fileName,
      validDurationInSeconds: 60 * 60,
    },
    {
      headers: {
        Authorization: auth.authorizationToken,
      },
    },
  );
  return `${baseUrl}?Authorization=${encodeURIComponent(tokenResponse.data.authorizationToken)}&v=${encodeURIComponent(sourceHash)}`;
}

const GAME_ID_FROM_KEY = /^games\/(\d+)-/;

export async function listGameIdsWithImages(bucketId: string): Promise<Set<number>> {
  const auth = await authorizeBackblazeB2();
  const gameIds = new Set<number>();
  let startFileName: string | undefined;

  do {
    const response = await axios.post<BackblazeB2ListFileNamesResponse>(
      `${auth.apiUrl}/b2api/v2/b2_list_file_names`,
      {
        bucketId,
        maxFileCount: 10000,
        prefix: "games/",
        ...(startFileName ? { startFileName } : {}),
      },
      { headers: { Authorization: auth.authorizationToken } },
    );

    for (const file of response.data.files) {
      const match = GAME_ID_FROM_KEY.exec(file.fileName);
      if (match) gameIds.add(Number(match[1]));
    }

    startFileName = response.data.nextFileName ?? undefined;
  } while (startFileName);

  return gameIds;
}
