import { IS_TEST_MODE } from "../config/testMode.js";

/**
 * Explains why a command that writes state shared with production refuses to run.
 *
 * A PR preview in the test guild talks to the production API, so a command that
 * syncs the whole membership or bulk-writes shared records would act on production
 * from a guild that only holds test accounts. Returns null when the command may run.
 */
export function sharedStateCommandRefusal(
  commandName: string,
  testMode: boolean = IS_TEST_MODE,
): string | null {
  if (!testMode) return null;
  return `\`${commandName}\` is disabled in test mode. This bot shares the production API, ` +
    "so its writes would land in production data. Run it from the production bot instead.";
}
