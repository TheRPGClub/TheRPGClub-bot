import { Role } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { MEMBER_ROLE_ID, NEWCOMERS_ROLE_ID } from "../config/roles.js";

@Discord()
export class MessageCreated {
  @On()
  async messageCreate(
    [message]: ArgsOf<"messageCreate">,
    _client: Client,
  ): Promise<void> {
    void _client;
    const userName: string | undefined =
      message.member?.nickname?.length ? message.member?.nickname : message.member?.displayName;

    const hasMemberRole: boolean = message.member!.roles.cache.has(MEMBER_ROLE_ID);
    if (!hasMemberRole) {
      const membersRole: Role | undefined = message.member!.guild.roles.cache.get(MEMBER_ROLE_ID);
      const newcomersRole: Role | undefined =
        message.member!.guild.roles.cache.get(NEWCOMERS_ROLE_ID);
      if (membersRole) {
        console.log(`Granting member role to ${userName}`);
        message.member!.roles.add(membersRole);
      }
      if (newcomersRole) {
        console.log(`Removing newcomers role from ${userName}`);
        message.member!.roles.remove(newcomersRole);
      }
    }
  }
}
