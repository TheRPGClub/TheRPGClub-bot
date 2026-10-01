import test from "node:test";
import assert from "node:assert/strict";
import { PermissionsBitField } from "discord.js";

import { canUseHelpLevel, getHelpAccess } from "../commands/help/help-access.js";
import { buildHelpCategoryResponse, buildMainHelpResponse } from "../commands/help.command.js";

const OWNER_ID = "100";
const MEMBER_ID = "200";

function fakeInteraction(userId: string, flags: bigint[]): Parameters<typeof getHelpAccess>[0] {
  return {
    guild: { ownerId: OWNER_ID },
    memberPermissions: new PermissionsBitField(flags),
    user: { id: userId },
  } as unknown as Parameters<typeof getHelpAccess>[0];
}

function responseText(response: { components: unknown[] }): string {
  return JSON.stringify(
    response.components.map((component) => (component as { toJSON(): unknown }).toJSON()),
  );
}

test("getHelpAccess: plain member sees member help only", () => {
  const access = getHelpAccess(fakeInteraction(MEMBER_ID, []));
  assert.deepEqual(access, { member: true, moderator: false, admin: false, owner: false });
});

test("getHelpAccess: Manage Messages grants moderator, Administrator grants both", () => {
  const mod = getHelpAccess(fakeInteraction(MEMBER_ID, [PermissionsBitField.Flags.ManageMessages]));
  assert.equal(mod.moderator, true);
  assert.equal(mod.admin, false);

  const adminFlags = [PermissionsBitField.Flags.Administrator];
  const admin = getHelpAccess(fakeInteraction(MEMBER_ID, adminFlags));
  assert.equal(admin.moderator, true);
  assert.equal(admin.admin, true);
  assert.equal(admin.owner, false);
});

test("getHelpAccess: guild owner is owner, and nothing is granted outside a guild", () => {
  assert.equal(getHelpAccess(fakeInteraction(OWNER_ID, [])).owner, true);

  const dm = { guild: null, memberPermissions: null, user: { id: OWNER_ID } };
  const access = getHelpAccess(dm as unknown as Parameters<typeof getHelpAccess>[0]);
  assert.deepEqual(access, { member: true, moderator: false, admin: false, owner: false });
});

test("canUseHelpLevel: an unset level means every member", () => {
  const access = getHelpAccess(fakeInteraction(MEMBER_ID, []));
  assert.equal(canUseHelpLevel(access, undefined), true);
  assert.equal(canUseHelpLevel(access, "admin"), false);
});

test("buildMainHelpResponse hides staff commands from members", () => {
  const member = responseText(buildMainHelpResponse(getHelpAccess(fakeInteraction(MEMBER_ID, []))));
  assert.ok(member.includes("todo"));
  for (const hidden of ["superadmin", "publicreminder", "Admin tools", "Moderator tools", "rss"]) {
    assert.ok(!member.includes(hidden), `member main menu should not list ${hidden}`);
  }

  const owner = responseText(buildMainHelpResponse({
    member: true,
    moderator: true,
    admin: true,
    owner: true,
  }));
  for (const shown of ["superadmin", "publicreminder", "Admin tools", "Moderator tools", "rss"]) {
    assert.ok(owner.includes(shown), `owner main menu should list ${shown}`);
  }
});

test("buildHelpCategoryResponse gates staff menus and rejects unknown values", () => {
  const member = getHelpAccess(fakeInteraction(MEMBER_ID, []));
  assert.notEqual(buildHelpCategoryResponse("gamedb", member), null);
  assert.equal(buildHelpCategoryResponse("admin", member), null);
  assert.equal(buildHelpCategoryResponse("mod", member), null);
  assert.equal(buildHelpCategoryResponse("nope", member), null);

  const mod = getHelpAccess(fakeInteraction(MEMBER_ID, [PermissionsBitField.Flags.ManageMessages]));
  assert.notEqual(buildHelpCategoryResponse("mod", mod), null);
  assert.equal(buildHelpCategoryResponse("rss", mod), null);
  assert.equal(buildHelpCategoryResponse("superadmin", mod), null);
});
