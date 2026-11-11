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

test("new copies wait while catch-up's copy phase runs, and go again once it ends", () => {
  const lane = new NewsCopyLane();
  const hold = lane.holdForCatchUp();

  assert.ok(hold);
  assert.equal(lane.copyWaits(), true);
  hold.release();
  assert.equal(lane.copyWaits(), false);
});

test("catch-up's copy phase does not start while the history copy runs", async () => {
  const lane = new NewsCopyLane();
  const history = await lane.holdForHistory();

  assert.equal(lane.holdForCatchUp(), null);
  assert.equal(lane.historyRunning(), true);
  history.release();
  assert.equal(lane.historyRunning(), false);
  assert.ok(lane.holdForCatchUp());
});

test("the history copy takes over: catch-up is asked to stop and it waits for that", async () => {
  const lane = new NewsCopyLane();
  const catchUp = lane.holdForCatchUp();
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
  assert.equal(lane.holdForCatchUp(), null);
  history.release();
  assert.equal(lane.paused(), false);
});

test("one catch-up at a time", () => {
  const lane = new NewsCopyLane();

  assert.equal(lane.beginCatchUp(), true);
  assert.equal(lane.beginCatchUp(), false);
  lane.endCatchUp();
  assert.equal(lane.beginCatchUp(), true);
});

test("a released backfill is announced, saying whether copies waited meanwhile", async () => {
  const lane = new NewsCopyLane();
  const heard: [NewsBackfill, boolean][] = [];
  lane.onRelease((kind, copiesWaited) => heard.push([kind, copiesWaited]));

  lane.holdForCatchUp()?.release();
  const busy = lane.holdForCatchUp();
  lane.copyWaits();
  busy?.release();
  (await lane.holdForHistory()).release();

  assert.deepEqual(heard, [["catch-up", false], ["catch-up", true], ["history", false]]);
});

test("idle() settles once no backfill holds the lane", async () => {
  const lane = new NewsCopyLane();
  await lane.idle();
  const hold = lane.holdForCatchUp();
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

test("releasing twice is harmless", () => {
  const lane = new NewsCopyLane();
  const hold = lane.holdForCatchUp();
  hold?.release();
  const next = lane.holdForCatchUp();
  hold?.release();

  assert.ok(next);
  assert.equal(lane.paused(), true);
});
