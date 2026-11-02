import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import {
  onGuildChannelCreate,
  onGuildChannelDelete,
  onGuildChannelUpdate,
} from "../services/GuildChannelSync.js";

/** Keeps the API's guild channel list (the website's channel pickers) current. */
@Discord()
export class GuildChannelSyncEvents {
  @On({ event: "channelCreate" })
  async syncCreatedChannel([channel]: ArgsOf<"channelCreate">): Promise<void> {
    await onGuildChannelCreate(channel);
  }

  @On({ event: "channelUpdate" })
  async syncUpdatedChannel([oldChannel, newChannel]: ArgsOf<"channelUpdate">): Promise<void> {
    await onGuildChannelUpdate(oldChannel, newChannel);
  }

  @On({ event: "channelDelete" })
  async syncDeletedChannel([channel]: ArgsOf<"channelDelete">): Promise<void> {
    await onGuildChannelDelete(channel);
  }
}
