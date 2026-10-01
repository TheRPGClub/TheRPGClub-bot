import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import { removeDeletedThreadLinks } from "../services/ThreadDeleteCleanup.js";

@Discord()
export class ThreadDeleted {
  @On()
  async threadDelete([thread]: ArgsOf<"threadDelete">): Promise<void> {
    await removeDeletedThreadLinks(thread.id);
  }
}
