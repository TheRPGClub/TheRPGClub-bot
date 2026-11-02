import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import { recordRoleChange } from "../services/MemberRoleSync.js";

/** Reports a member's Discord roles to the API whenever they change. */
@Discord()
export class MemberRoleSync {
  @On({ event: "guildMemberUpdate" })
  async syncRoles([oldMember, newMember]: ArgsOf<"guildMemberUpdate">): Promise<void> {
    await recordRoleChange(oldMember, newMember);
  }
}
