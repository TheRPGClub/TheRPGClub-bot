import { stopAllTrackedIntervals } from "../utilities/IntervalUtils.js";
import { logError, logInfo, logWarn } from "../utilities/LogUtils.js";

const LOG_CONTEXT = "ShutdownService";

export const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGBREAK"];

// Docker sends SIGKILL 10 seconds after SIGTERM by default. Two capped steps fit inside it.
export const SHUTDOWN_STEP_TIMEOUT_MS = 4_000;

export interface IShutdownSteps {
  /** Sends buffered console logs to Discord. Runs while the client can still post. */
  flushLogs: () => Promise<void>;
  /** Closes the gateway connection. */
  destroyClient: () => Promise<void>;
  exit: (code: number) => void;
  stopIntervals?: () => number;
  stepTimeoutMs?: number;
}

/** Starts a shutdown once. Later calls return the shutdown already running. */
export type Shutdown = (reason: string, exitCode?: number) => Promise<void>;

type StepOutcome = "done" | "timed out";

async function runStep(
  name: string,
  step: () => Promise<void>,
  timeoutMs: number,
): Promise<StepOutcome> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<StepOutcome>((resolve) => {
    timer = setTimeout(() => resolve("timed out"), timeoutMs);
  });
  try {
    const outcome = await Promise.race([step().then((): StepOutcome => "done"), timeout]);
    if (outcome === "timed out") {
      logWarn(LOG_CONTEXT, `${name} did not finish within ${timeoutMs}ms; continuing.`);
    }
    return outcome;
  } catch (err) {
    logError(`${LOG_CONTEXT}.${name}`, err);
    return "done";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Builds the one shutdown path: stop every tracked interval, flush the log buffer, destroy
 * the client, then exit. Each awaited step is capped so a hung send or socket close can
 * never hold the process past its grace period.
 */
export function createShutdown(steps: IShutdownSteps): Shutdown {
  const stopIntervals = steps.stopIntervals ?? stopAllTrackedIntervals;
  const stepTimeoutMs = steps.stepTimeoutMs ?? SHUTDOWN_STEP_TIMEOUT_MS;
  let running: Promise<void> | null = null;

  return (reason: string, exitCode: number = 0): Promise<void> => {
    if (running) return running;
    running = (async () => {
      const cleared = stopIntervals();
      logInfo(LOG_CONTEXT, `Shutting down (${reason}); cleared ${cleared} interval(s).`);
      await runStep("flushLogs", steps.flushLogs, stepTimeoutMs);
      await runStep("destroyClient", steps.destroyClient, stepTimeoutMs);
      steps.exit(exitCode);
    })();
    return running;
  };
}

/**
 * Any SIGINT or SIGTERM listener replaces Node's default exit, so this one must end the
 * process itself. A second signal while shutdown runs exits at once.
 */
export function installShutdownSignalHandlers(
  shutdown: Shutdown,
  exit: (code: number) => void,
  target: Pick<NodeJS.Process, "on"> = process,
): void {
  let received = false;
  for (const signal of SHUTDOWN_SIGNALS) {
    target.on(signal, () => {
      if (received) {
        exit(1);
        return;
      }
      received = true;
      void shutdown(signal);
    });
  }
}
