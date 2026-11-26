import { buildErrorReply, buildTextReply } from "../functions/ComponentsV2Utils.js";
import type { PublicOrPrivateAnswer } from "../functions/PublicAnswer.js";
import { buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";
import { buildPatchPost, type IPatchPostText } from "./PatchPost.js";
import { apiGet, apiGetOrThrow } from "./RpgClubApiClient.js";

// /patch-notes [number] (spec api#510, bot#1594): the latest published Patch, or the
// numbered one, posted publicly as the same message as its #patch-notes post, with the
// club's current versions in small print under it (left out until versioning starts).
// A number with no published Patch, or no Patch yet, is answered privately. The command
// belongs to the patch_notes Feature (config/featureGate.ts). The API reads run as the
// bot's service token, which never sees a draft.

/** The current version of each repo (GET /versions), null until versioning starts. */
export interface IClubVersions {
  api: string | null;
  bot: string | null;
  www: string | null;
}

/** What /patch-notes reads; tests pass a fake. */
export interface IPatchNotesApi {
  /** The newest published Patch, or null when none is published. */
  latest(): Promise<IPatchPostText | null>;
  /** Published Patch `number`, or null when there is none (or only a draft). */
  byNumber(number: number): Promise<IPatchPostText | null>;
  versions(): Promise<IClubVersions>;
}

interface IPatchPayload {
  number: number;
  title: string | null;
  cut_body: string | null;
  published_at: string | null;
}

function toPatchText(patch: IPatchPayload): IPatchPostText {
  return {
    number: patch.number,
    title: patch.title,
    cutBody: patch.cut_body ?? "",
    publishedAt: patch.published_at,
  };
}

export const PATCH_NOTES_API: IPatchNotesApi = {
  latest: async () => {
    const page = await apiGetOrThrow<{ data: IPatchPayload[] }>("/patches", {
      params: { per: 1 },
    });
    const newest = page.data[0];
    return newest ? toPatchText(newest) : null;
  },
  byNumber: async (number) => {
    const found = await apiGet<{ data: IPatchPayload }>(`/patches/${number}`);
    return found ? toPatchText(found.data) : null;
  },
  versions: async () =>
    (await apiGetOrThrow<{ data: IClubVersions }>("/versions")).data,
};

/** The website's order and names: "site 1.4.0 · api 1.2.0 · bot 2.3.1". */
const VERSION_NAMES: ReadonlyArray<readonly [keyof IClubVersions, string]> = [
  ["www", "site"],
  ["api", "api"],
  ["bot", "bot"],
];

/**
 * The small versions line, naming only the repos that have a version; null while none
 * has (versioning hasn't started).
 */
export function patchNotesVersionsLine(versions: IClubVersions | null): string | null {
  if (!versions) return null;
  const parts = VERSION_NAMES.flatMap(([key, name]) => {
    const version = versions[key]?.trim();
    return version ? [`${name} ${version}`] : [];
  });
  return parts.length ? `-# ${parts.join(" · ")}` : null;
}

function privateNote(content: string): PublicOrPrivateAnswer {
  return { private: buildTextReply(content, true) };
}

/**
 * /patch-notes: Patch `number` (or the latest when null) as its public post with the
 * versions line, or a private reply. A failed versions read only drops the line; a failed
 * Patch read is shown privately with its request and response.
 */
export async function buildPatchNotesAnswer(
  number: number | null,
  api: IPatchNotesApi = PATCH_NOTES_API,
): Promise<PublicOrPrivateAnswer> {
  const versions = api.versions().catch((err: unknown) => {
    logError("PatchNotesCommand.versions", err);
    return null;
  });
  let patch: IPatchPostText | null;
  try {
    patch = number === null ? await api.latest() : await api.byNumber(number);
  } catch (err: unknown) {
    const label = number === null
      ? "Could not read the latest Patch."
      : `Could not read Patch ${number}.`;
    return { private: buildErrorReply(buildApiErrorMessage(label, err), true) };
  }
  if (!patch) {
    return privateNote(number === null
      ? "No Patch has been published yet."
      : `There is no Patch ${number}.`);
  }
  const post = buildPatchPost(patch, { footnote: patchNotesVersionsLine(await versions) });
  return { public: post };
}

