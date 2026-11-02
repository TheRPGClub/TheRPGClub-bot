import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import { recordMemberDeparture, recordRoleChange } from "../services/MemberRoleSync.js";

/** Reports a member's Discord roles to the API whenever they change or they leave. */
@Discord()
export class MemberRoleSync {
  @On({ event: "guildMemberUpdate" })
  async syncRoles([oldMember, newMember]: ArgsOf<"guildMemberUpdate">): Promise<void> {
    await recordRoleChange(oldMember, newMember);
  }

  /** A leave, kick or ban (all emit guildMemberRemove) clears the website roles. */
  @On({ event: "guildMemberRemove" })
  async clearRoles([member]: ArgsOf<"guildMemberRemove">): Promise<void> {
    await recordMemberDeparture(member);
  }
}
