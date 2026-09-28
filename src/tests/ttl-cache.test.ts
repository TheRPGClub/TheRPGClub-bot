import assert from "node:assert/strict";
import test from "node:test";
import { createTtlCache } from "../functions/TtlCache.js";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test("createTtlCache blocks only the first load and shares it", async () => {
  let calls = 0;
  const cache = createTtlCache(async () => {
    calls += 1;
    return calls;
  }, 60_000);
  const [a, b] = await Promise.all([cache.get(), cache.get()]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(await cache.get(), 1);
  assert.equal(calls, 1);
});

test("createTtlCache serves the stale value while refreshing an expired entry", async () => {
  const fetches: Array<ReturnType<typeof deferred<string>>> = [];
  const cache = createTtlCache(() => {
    const next = deferred<string>();
    fetches.push(next);
    return next.promise;
  }, 0);

  const first = cache.get();
  fetches[0].resolve("old");
  assert.equal(await first, "old");

  assert.equal(await cache.get(), "old");
  assert.equal(await cache.get(), "old");
  assert.equal(fetches.length, 2);

  fetches[1].resolve("new");
  await fetches[1].promise;
  await new Promise((res) => setImmediate(res));
  assert.equal(await cache.get(), "new");
});

test("createTtlCache keeps the stale value when a background refresh fails", async () => {
  let calls = 0;
  const cache = createTtlCache(async () => {
    calls += 1;
    if (calls > 1) throw new Error("upstream down");
    return "cached";
  }, 0);
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await cache.get(), "cached");
    assert.equal(await cache.get(), "cached");
    await cache.refresh();
    assert.equal(await cache.get(), "cached");
  } finally {
    console.error = originalError;
  }
});

test("createTtlCache refresh supersedes an in-flight fetch", async () => {
  const fetches: Array<ReturnType<typeof deferred<string>>> = [];
  const cache = createTtlCache(() => {
    const next = deferred<string>();
    fetches.push(next);
    return next.promise;
  }, 60_000);

  const initial = cache.get();
  fetches[0].resolve("seed");
  await initial;

  void cache.refresh();
  const refreshed = cache.refresh();
  assert.equal(fetches.length, 3);
  fetches[2].resolve("latest");
  await refreshed;
  fetches[1].resolve("superseded");
  await fetches[1].promise;
  assert.equal(await cache.get(), "latest");
});

test("createTtlCache clear forces the next get to load again", async () => {
  let calls = 0;
  const cache = createTtlCache(async () => {
    calls += 1;
    return calls;
  }, 60_000);
  assert.equal(await cache.get(), 1);
  cache.clear();
  assert.equal(await cache.get(), 2);
});
