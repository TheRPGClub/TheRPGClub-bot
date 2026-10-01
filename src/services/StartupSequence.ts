import { logError, logWarn } from "../utilities/LogUtils.js";

// Matched verbatim by scripts/preview/preview.sh and DiscordConsoleLogger as the ready line.
export const STARTUP_COMPLETE_LINE = "Startup sequence completed.";

export interface IStartupStep {
  name: string;
  run: () => unknown;
}

/**
 * Runs each startup step in order. A step that throws is logged and skipped, so one
 * failing service does not stop the ones after it. `clientReady` fires once, so
 * nothing would retry a step the sequence never reached. Returns the failed names.
 * Each failure's error reaches only stdout; the summary warning also reaches Discord.
 */
export async function runStartupSequence(
  steps: readonly IStartupStep[],
): Promise<string[]> {
  const failed: string[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch (err: unknown) {
      failed.push(step.name);
      logError(`Startup:${step.name}`, err);
    }
  }

  console.log(STARTUP_COMPLETE_LINE);
  // After the ready line: DiscordConsoleLogger drops everything else until it sees it.
  if (failed.length > 0) {
    logWarn("Startup", `Failed startup steps: ${failed.join(", ")}`);
  }
  return failed;
}
