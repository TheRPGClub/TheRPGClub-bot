import axios from "axios";

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
  accountId: string;
  authorizationToken: string;
  apiInfo?: {
    storageApi?: {
      apiUrl?: string;
      downloadUrl?: string;
      recommendedPartSize?: number;
      absoluteMinimumPartSize?: number;
    };
  };
};

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
    (process.env.BACKBLAZE_B2_APPLICATION_KEY ?? "").trim(),
  );
}

export async function authorizeBackblazeB2(): Promise<BackblazeB2AuthPayload> {
  const keyId = getRequiredEnv("BACKBLAZE_B2_KEY_ID");
  const applicationKey = getRequiredEnv("BACKBLAZE_B2_APPLICATION_KEY");
  const auth = Buffer.from(`${keyId}:${applicationKey}`, "utf8").toString("base64");

  const response = await axios.get<BackblazeB2AuthResponse>(BACKBLAZE_AUTH_URL, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

  const data = response.data;
  const apiUrl = data.apiInfo?.storageApi?.apiUrl ?? "";
  const downloadUrl = data.apiInfo?.storageApi?.downloadUrl ?? "";
  const recommendedPartSize = data.apiInfo?.storageApi?.recommendedPartSize ?? 0;
  const absoluteMinimumPartSize = data.apiInfo?.storageApi?.absoluteMinimumPartSize ?? 0;

  if (!data.accountId || !data.authorizationToken || !apiUrl || !downloadUrl) {
    throw new Error("Backblaze B2 authorization response is missing required fields.");
  }

  return {
    accountId: data.accountId,
    authorizationToken: data.authorizationToken,
    apiUrl,
    downloadUrl,
    recommendedPartSize,
    absoluteMinimumPartSize,
  };
}

export async function testBackblazeB2Connection(): Promise<boolean> {
  await authorizeBackblazeB2();
  return true;
}

