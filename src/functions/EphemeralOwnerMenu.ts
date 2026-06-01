import type { RepliableInteraction } from "discord.js";
import { safeReply } from "./InteractionUtils.js";
import { buildComponentsV2Flags } from "./NominationListComponents.js";

/**
 * Manages a single ephemeral "owner action menu" per key (typically a user ID).
 * Call show() to dismiss any previous instance for that key and render a new one.
 * Call dismiss() to tear down the tracked instance without showing a replacement.
 *
 * Instantiate one EphemeralOwnerMenu per logical menu type at module scope so the
 * tracked state persists across interactions.
 */
export class EphemeralOwnerMenu {
  private readonly deletors = new Map<string, () => Promise<unknown>>();

  async show(
    interaction: RepliableInteraction,
    key: string,
    components: object[],
  ): Promise<void> {
    await this.deletors.get(key)?.().catch(() => null);
    this.deletors.delete(key);
    await safeReply(interaction, {
      components,
      flags: buildComponentsV2Flags(true),
    });
    this.deletors.set(key, () => interaction.deleteReply());
  }

  async dismiss(key: string): Promise<void> {
    await this.deletors.get(key)?.().catch(() => null);
    this.deletors.delete(key);
  }
}
