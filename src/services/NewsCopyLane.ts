// The copy lane (spec api#367): the category threads show News Copies in the order they were
// posted, so only one backfill copier posts at a time, oldest first: the history copy
// (`/news-import copy`) or catch-up's copy phase. While one runs, every other new copy waits
// (live posts, corrections, upload moves) and is posted after it, in date order.

/** A backfill copier: the history copy, or catch-up's copy phase. */
export type NewsBackfill = "history" | "catch-up";

/** A backfill's hold on the lane. */
export interface INewsCopyLaneHold {
  /** True once the history copy asked to take over: stop after the current item. */
  stopRequested(): boolean;
  /** Frees the lane. Releasing again does nothing. */
  release(): void;
}

type ReleaseListener = (kind: NewsBackfill, copiesWaited: boolean) => void;

interface IHolder {
  kind: NewsBackfill;
  stopRequested: boolean;
  released: Promise<void>;
  release: () => void;
}

export class NewsCopyLane {
  private holder: IHolder | null = null;
  /** Settles when a history copy waiting for catch-up's copy phase to stop takes over. */
  private historyTakingOver: Promise<void> | null = null;
  private copiesWaited = false;
  private catchUpRunning = false;
  /** A catch-up asked for while one ran: run once more after it, filing missed posts or not. */
  private catchUpAgain: { fileMissed: boolean } | null = null;
  private readonly listeners: ReleaseListener[] = [];

  /** True while a backfill copier runs (or the history copy waits to take over). */
  paused(): boolean {
    return this.holder !== null || this.historyTakingOver !== null;
  }

  /** True while the history copy runs, or waits to take over from catch-up. */
  historyRunning(): boolean {
    return this.historyTakingOver !== null || this.holder?.kind === "history";
  }

  /**
   * Asked before posting a new News Copy: true when it must wait for the backfill running
   * now. The lane notes that one waited, so a catch-up follows the backfill and posts it.
   */
  copyWaits(): boolean {
    if (!this.paused()) return false;
    this.copiesWaited = true;
    return true;
  }

  /** Catch-up's copy phase takes the lane; null while another backfill holds it. */
  holdForCatchUp(): INewsCopyLaneHold | null {
    if (this.paused()) return null;
    return this.hold("catch-up");
  }

  /**
   * The history copy takes the lane. Catch-up's copy phase, if it holds it, is asked to stop
   * after its current item, and the history copy holds the lane once it has. The runner
   * starts one history copy at a time.
   */
  async holdForHistory(): Promise<INewsCopyLaneHold> {
    const takingOver = this.stopCatchUp();
    this.historyTakingOver = takingOver;
    try {
      await takingOver;
    } finally {
      this.historyTakingOver = null;
    }
    return this.hold("history");
  }

  /** Settles once no backfill holds the lane, nor waits to take it. */
  async idle(): Promise<void> {
    for (;;) {
      const busy = this.holder?.released ?? this.historyTakingOver;
      if (!busy) return;
      await busy;
    }
  }

  /**
   * Starts a catch-up unless one is running. Then it is false, and the running catch-up is
   * asked to run once more when it finishes (several asks make one more run, filing missed
   * posts when any asked for that). Call `endCatchUp` after.
   */
  beginCatchUp(fileMissed: boolean): boolean {
    if (!this.catchUpRunning) {
      this.catchUpRunning = true;
      return true;
    }
    this.catchUpAgain = { fileMissed: fileMissed || (this.catchUpAgain?.fileMissed ?? false) };
    return false;
  }

  /** The running catch-up's next run, if one was asked for meanwhile (taken, so asked once). */
  nextCatchUp(): { fileMissed: boolean } | null {
    const next = this.catchUpAgain;
    this.catchUpAgain = null;
    return next;
  }

  /** Ends the running catch-up; a run still asked for is dropped. */
  endCatchUp(): void {
    this.catchUpRunning = false;
    this.catchUpAgain = null;
  }

  /** Calls `listener` each time a backfill frees the lane, saying whether copies waited. */
  onRelease(listener: ReleaseListener): void {
    this.listeners.push(listener);
  }

  /** Asks whatever holds the lane to stop, and settles once it has let go. */
  private async stopCatchUp(): Promise<void> {
    while (this.holder) {
      this.holder.stopRequested = true;
      await this.holder.released;
    }
  }

  private hold(kind: NewsBackfill): INewsCopyLaneHold {
    let resolve = (): void => {};
    const released = new Promise<void>((done) => {
      resolve = done;
    });
    const holder: IHolder = { kind, stopRequested: false, released, release: resolve };
    this.holder = holder;
    this.copiesWaited = false;
    return {
      stopRequested: () => holder.stopRequested,
      release: () => {
        if (this.holder !== holder) return;
        this.holder = null;
        const waited = this.copiesWaited;
        this.copiesWaited = false;
        holder.release();
        for (const listener of this.listeners) listener(kind, waited);
      },
    };
  }
}

/** The bot's one copy lane. */
export const NEWS_COPY_LANE = new NewsCopyLane();
