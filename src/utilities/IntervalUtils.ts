import { logError, logWarn } from "./LogUtils.js";

const trackedIntervals = new Set<NodeJS.Timeout>();
const activeScheduledTasks = new Set<IScheduledTask>();

/**
 * Starts a setInterval that graceful shutdown clears. Every long-lived interval goes
 * through here (or createIntervalTask, or createScheduledTask) so a SIGTERM never waits on
 * a forgotten timer.
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
 * Clears every tracked interval and stops every scheduled task, so a run still in flight
 * does not schedule another. Returns how many it stopped.
 */
export function stopAllTrackedIntervals(): number {
  const count = trackedIntervals.size + activeScheduledTasks.size;
  for (const timer of trackedIntervals) clearInterval(timer);
  trackedIntervals.clear();
  for (const task of [...activeScheduledTasks]) task.stop();
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

/** The longest delay setTimeout honors (about 24.8 days). */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export interface IScheduledTaskOptions {
  /** Log context for errors the task lets escape. */
  name: string;
  /**
   * The work for one run. Resolves to how long to wait before the next run; a value that
   * is not a finite, non-negative number falls back to `retryDelayMs`.
   */
  task: () => Promise<number>;
  /** How long to wait after a run that throws. */
  retryDelayMs: number;
}

export interface IScheduledTask {
  /** Runs once now and keeps going. Returns false, and does nothing, when already started. */
  start(): boolean;
  /** Clears the pending run; a run in flight finishes without scheduling another. */
  stop(): void;
  /** Runs now instead of at the scheduled time, or again right after a run in flight. */
  runSoon(): void;
}

/**
 * Like createIntervalTask, but each run picks the delay before the next one, for a loop
 * that should sleep until something is due rather than tick at a fixed pace. Runs never
 * overlap, and a run asked for while one is in flight follows it instead of being lost.
 */
export function createScheduledTask(options: IScheduledTaskOptions): IScheduledTask {
  let timer: NodeJS.Timeout | null = null;
  let active = false;
  let running = false;
  let runAgain = false;

  const clearTimer = (): void => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const schedule = (delayMs: number): void => {
    clearTimer();
    if (!active) return;
    // Node fires an out-of-range or NaN delay after 1ms, which would spin the loop.
    const safeDelayMs = Number.isFinite(delayMs) && delayMs >= 0
      ? Math.min(delayMs, MAX_TIMEOUT_MS)
      : options.retryDelayMs;
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, safeDelayMs);
  };

  const run = async (): Promise<void> => {
    if (running) {
      runAgain = true;
      return;
    }
    running = true;
    runAgain = false;
    let delayMs = options.retryDelayMs;
    try {
      delayMs = await options.task();
    } catch (err) {
      logError(options.name, err);
    } finally {
      running = false;
    }
    schedule(runAgain ? 0 : delayMs);
  };

  const scheduledTask: IScheduledTask = {
    start(): boolean {
      if (active) return false;
      active = true;
      activeScheduledTasks.add(scheduledTask);
      void run();
      return true;
    },
    stop(): void {
      active = false;
      runAgain = false;
      activeScheduledTasks.delete(scheduledTask);
      clearTimer();
    },
    runSoon(): void {
      if (!active) return;
      if (running) {
        runAgain = true;
        return;
      }
      schedule(0);
    },
  };
  return scheduledTask;
}
