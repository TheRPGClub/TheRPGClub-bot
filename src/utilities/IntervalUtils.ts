import { logError, logWarn } from "./LogUtils.js";

const trackedIntervals = new Set<NodeJS.Timeout>();
const trackedTimeouts = new Set<NodeJS.Timeout>();

/**
 * Starts a setInterval that graceful shutdown clears. Every long-lived interval goes
 * through here (or createIntervalTask) so a SIGTERM never waits on a forgotten timer.
 */
export function startTrackedInterval(callback: () => void, intervalMs: number): NodeJS.Timeout {
  const timer = setInterval(callback, intervalMs);
  trackedIntervals.add(timer);
  return timer;
}

/** Clears an interval from startTrackedInterval and forgets it. */
export function stopTrackedInterval(timer: NodeJS.Timeout): void {
  clearInterval(timer);
  trackedIntervals.delete(timer);
}

/**
 * Starts a setTimeout that graceful shutdown clears, for a loop that schedules its next
 * run from the last one's result. The timer is forgotten once it fires.
 */
export function startTrackedTimeout(callback: () => void, delayMs: number): NodeJS.Timeout {
  const timer = setTimeout(() => {
    trackedTimeouts.delete(timer);
    callback();
  }, delayMs);
  trackedTimeouts.add(timer);
  return timer;
}

/** Clears a timeout from startTrackedTimeout and forgets it. */
export function stopTrackedTimeout(timer: NodeJS.Timeout): void {
  clearTimeout(timer);
  trackedTimeouts.delete(timer);
}

/** Clears every tracked interval and pending tracked timeout. Returns how many it cleared. */
export function stopAllTrackedIntervals(): number {
  const count = trackedIntervals.size + trackedTimeouts.size;
  for (const timer of trackedIntervals) clearInterval(timer);
  trackedIntervals.clear();
  for (const timer of trackedTimeouts) clearTimeout(timer);
  trackedTimeouts.clear();
  return count;
}

export interface IIntervalTaskOptions {
  /** Log context for skipped ticks and errors the task lets escape. */
  name: string;
  /** Interval between ticks. */
  intervalMs: number;
  /** The work for one tick. A tick is skipped while the previous one is still running. */
  task: () => Promise<void>;
  /** Run one tick immediately on start. Defaults to true. */
  runOnStart?: boolean;
}

export interface IIntervalTask {
  /** Starts the interval. Returns false, and does nothing, when it has already started. */
  start(): boolean;
  /** Clears the interval so a later start() can begin again. */
  stop(): void;
  /** Runs one tick now, under the same in-flight guard as the interval. */
  runNow(): Promise<void>;
}

/**
 * An interval that never overlaps itself and never starts twice: a running flag skips a
 * tick while the last one is still in flight, and a started flag makes start() idempotent.
 */
export function createIntervalTask(options: IIntervalTaskOptions): IIntervalTask {
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  const runNow = async (): Promise<void> => {
    if (running) {
      logWarn(options.name, "Previous run still in flight, skipping this tick.");
      return;
    }
    running = true;
    try {
      await options.task();
    } catch (err) {
      logError(options.name, err);
    } finally {
      running = false;
    }
  };

  return {
    start(): boolean {
      if (timer) return false;
      timer = startTrackedInterval(() => {
        void runNow();
      }, options.intervalMs);
      if (options.runOnStart ?? true) {
        void runNow();
      }
      return true;
    },
    stop(): void {
      if (!timer) return;
      stopTrackedInterval(timer);
      timer = null;
    },
    runNow,
  };
}
