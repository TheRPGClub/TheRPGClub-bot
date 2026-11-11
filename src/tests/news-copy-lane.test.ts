import assert from "node:assert/strict";
import test from "node:test";
import { NewsCopyLane, type NewsBackfill } from "../services/NewsCopyLane.js";

// The copy lane (spec api#367, review fixes): one backfill copier at a time, the history
// copy or catch-up's copy phase, and every other new News Copy waits while one runs, so the
// category threads stay in date order.

test("new copies go at once while no backfill runs", () => {
  const lane = new NewsCopyLane();

  assert.equal(lane.copyWaits(), false);
  assert.equal(lane.paused(), false);
});

test("new copies wait while catch-up's copy phase runs, and go again once it ends", async () => {
  const lane = new NewsCopyLane();
  const hold = await lane.holdForCatchUp();

  assert.ok(hold);
  assert.equal(lane.copyWaits(), true);
  hold.release();
  assert.equal(lane.copyWaits(), false);
});

test("catch-up's copy phase does not start while the history copy runs", async () => {
  const lane = new NewsCopyLane();
  const history = await lane.holdForHistory();

  assert.equal(await lane.holdForCatchUp(), null);
  assert.equal(lane.historyRunning(), true);
  history.release();
  assert.equal(lane.historyRunning(), false);
  assert.ok(await lane.holdForCatchUp());
});

test("the history copy takes over: catch-up is asked to stop and it waits for that", async () => {
  const lane = new NewsCopyLane();
  const catchUp = await lane.holdForCatchUp();
  assert.ok(catchUp);

  let held = false;
  const taking = lane.holdForHistory().then((hold) => {
    held = true;
    return hold;
  });
  await Promise.resolve();

  assert.equal(catchUp.stopRequested(), true);
  assert.equal(held, false);
  // Waiting to take over already counts: catch-up cannot hold the lane again meanwhile.
  assert.equal(lane.historyRunning(), true);
  assert.equal(lane.copyWaits(), true);
  catchUp.release();
  const history = await taking;
  assert.equal(held, true);
  assert.equal(await lane.holdForCatchUp(), null);
  history.release();
  assert.equal(lane.paused(), false);
});

test("one catch-up at a time", () => {
  const lane = new NewsCopyLane();

  assert.equal(lane.beginCatchUp(true), true);
  assert.equal(lane.beginCatchUp(true), false);
  lane.endCatchUp();
  assert.equal(lane.beginCatchUp(true), true);
});

test("catch-ups asked for while one runs make one more run, filing when any asked", () => {
  const lane = new NewsCopyLane();
  lane.beginCatchUp(false);

  assert.equal(lane.nextCatchUp(), null);
  lane.beginCatchUp(true);
  lane.beginCatchUp(false);
  assert.deepEqual(lane.nextCatchUp(), { fileMissed: true });
  assert.equal(lane.nextCatchUp(), null);
  lane.beginCatchUp(false);
  lane.endCatchUp();
  lane.beginCatchUp(false);
  assert.equal(lane.nextCatchUp(), null);
});

test("a released backfill is announced, saying whether copies waited meanwhile", async () => {
  const lane = new NewsCopyLane();
  const heard: [NewsBackfill, boolean][] = [];
  lane.onRelease((kind, copiesWaited) => heard.push([kind, copiesWaited]));

  (await lane.holdForCatchUp())?.release();
  const busy = await lane.holdForCatchUp();
  lane.copyWaits();
  busy?.release();
  (await lane.holdForHistory()).release();

  assert.deepEqual(heard, [["catch-up", false], ["catch-up", true], ["history", false]]);
});

test("idle() settles once no backfill holds the lane", async () => {
  const lane = new NewsCopyLane();
  await lane.idle();
  const hold = await lane.holdForCatchUp();
  let settled = false;
  const waiting = lane.idle().then(() => {
    settled = true;
  });
  await Promise.resolve();

  assert.equal(settled, false);
  hold?.release();
  await waiting;
  assert.equal(settled, true);
});

test("a correction waits for a backfill, then holds the lane", async () => {
  const lane = new NewsCopyLane();
  const catchUp = await lane.holdForCatchUp();
  let corrected = false;
  const correcting = lane.holdForCorrection().then((release) => {
    corrected = true;
    return release;
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(corrected, false);
  catchUp?.release();
  assert.ok(await correcting);
});

test("backfills wait for a correction being made, without pausing new copies", async () => {
  const lane = new NewsCopyLane();
  const release = await lane.holdForCorrection();
  const held: string[] = [];
  const catchUp = lane.holdForCatchUp().then((hold) => {
    held.push("catch-up");
    hold?.release();
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(held.length, 0);
  assert.equal(lane.copyWaits(), false);
  release?.();
  await catchUp;
  const history = lane.holdForHistory().then((hold) => {
    held.push("history");
    return hold;
  });
  const correction = await lane.holdForCorrection();
  assert.equal(correction, null);
  (await history).release();
  assert.deepEqual(held, ["catch-up", "history"]);
});

test("a correction is refused while the history copy runs", async () => {
  const lane = new NewsCopyLane();
  const history = await lane.holdForHistory();

  assert.equal(await lane.holdForCorrection(), null);
  history.release();
  assert.ok(await lane.holdForCorrection());
});

test("releasing twice is harmless", async () => {
  const lane = new NewsCopyLane();
  const hold = await lane.holdForCatchUp();
  hold?.release();
  const next = await lane.holdForCatchUp();
  hold?.release();

  assert.ok(next);
  assert.equal(lane.paused(), true);
});
