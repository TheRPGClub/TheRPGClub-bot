import assert from "node:assert/strict";
import test from "node:test";
import { Collection } from "discord.js";

import { memberHasAnyRole } from "../utilities/MemberRoleUtils.js";

type RoleMember = Parameters<typeof memberHasAnyRole>[0];

test("memberHasAnyRole: a raw API member's role id list", () => {
  const member = { roles: ["1", "2"] } as unknown as RoleMember;
  assert.equal(memberHasAnyRole(member, ["2", "3"]), true);
  assert.equal(memberHasAnyRole(member, ["3"]), false);
});

test("memberHasAnyRole: a cached GuildMember's role manager", () => {
  const cache = new Collection<string, unknown>([["7", {}]]);
  const member = { roles: { cache } } as unknown as RoleMember;
  assert.equal(memberHasAnyRole(member, ["7"]), true);
  assert.equal(memberHasAnyRole(member, ["8"]), false);
});

test("memberHasAnyRole: no member, or no roles, holds nothing", () => {
  assert.equal(memberHasAnyRole(null, ["1"]), false);
  assert.equal(memberHasAnyRole({} as unknown as RoleMember, ["1"]), false);
});
