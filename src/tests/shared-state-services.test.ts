import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discordx";
import {
  SHARED_STATE_SERVICES,
  startSharedStateServices,
  type ISharedStateService,
} from "../services/SharedStateServices.js";

const CLIENT = {} as Client;

function fakeServices(started: string[]): ISharedStateService[] {
  return ["A", "B"].map((name) => ({ name, start: () => { started.push(name); } }));
}

test("startSharedStateServices starts every service outside test mode", () => {
  const started: string[] = [];
  startSharedStateServices(CLIENT, false, fakeServices(started));
  assert.deepEqual(started, ["A", "B"]);
});

test("startSharedStateServices starts nothing in test mode", () => {
  const started: string[] = [];
  startSharedStateServices(CLIENT, true, fakeServices(started));
  assert.deepEqual(started, []);
});

test("every service that claims or writes shared API state is gated", () => {
  assert.deepEqual(SHARED_STATE_SERVICES.map((service) => service.name), [
    "VotingEventService",
    "PublicReminderService",
    "ThreadSyncService",
    "ThreadLinkPromptService",
    "GameReleaseAnnouncementService",
    "RssFeedService",
  ]);
});
