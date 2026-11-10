import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  type CommandInteraction,
  MessageFlags,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";

import { FEATURE_ACCESS_WAIT_MS } from "../config/cacheDefaults.js";
import { settleWithin, type FeatureState } from "../functions/FeatureGate.js";
import {
  safeDeferReply,
  safeReply,
  safeRespond,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import { buildErrorReply, buildTextReply } from "../functions/ComponentsV2Utils.js";
import { featureFlagCache } from "../services/FeatureAccessService.js";
import {
  FEATURE_STATE_LABELS,
  FEATURE_STATES,
  featureFlagChoices,
  listFeatureFlagsReply,
  setFeatureFlagReply,
} from "../services/FeatureFlagService.js";
import { buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";

/** The API's limit on a flag change reason (PATCH /features/:key). */
const FLAG_REASON_MAX = 500;

const FLAG_STATE_CHOICES = FEATURE_STATES.map((state) => ({
  name: FEATURE_STATE_LABELS[state],
  value: state,
}));

/**
 * Offers the registry's Features from the bot's club-wide flag cache, so it costs no API
 * call once warm. A cold or failing read is capped at FEATURE_ACCESS_WAIT_MS (logged) and
 * offers nothing, well inside Discord's autocomplete window.
 */
async function autocompleteFeature(interaction: AutocompleteInteraction): Promise<void> {
  const query = String(interaction.options.getFocused() ?? "");
  const flags = await settleWithin(
    "Feature Flag lookup for /flag autocomplete",
    featureFlagCache.flags(),
    FEATURE_ACCESS_WAIT_MS,
  );
  await safeRespond(interaction, featureFlagChoices(query, flags ?? []));
}

/**
 * `/flag` (spec api#347): staff manage Feature Flags from Discord. The API decides who may
 * (Admins and Superadmins, from the acting user's stored roles), so the command has no
 * Discord permission check and stays visible to everyone. Never feature-gated itself.
 */
@Discord()
@SlashGroup({ description: "Feature Flags (Admins and Superadmins)", name: "flag" })
@SlashGroup("flag")
export class FlagCommand {
  @Slash({ description: "List every Feature and its Feature Flag state", name: "list" })
  async list(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    let text: string;
    try {
      text = await listFeatureFlagsReply(interaction.user.id);
    } catch (error: unknown) {
      const message = buildApiErrorMessage("Could not list the Feature Flags", error);
      await safeReply(interaction, buildErrorReply(message, true));
      return;
    }
    await safeReply(interaction, buildTextReply(text, true));
  }

  @Slash({ description: "Set a Feature Off, Preview or Live", name: "set" })
  async set(
    @SlashOption({
      description: "The Feature to change",
      name: "feature",
      required: true,
      type: ApplicationCommandOptionType.String,
      autocomplete: autocompleteFeature,
    })
    rawFeature: string,
    @SlashChoice(...FLAG_STATE_CHOICES)
    @SlashOption({
      description: "Off: nobody. Preview: Admins and Superadmins. Live: everyone.",
      name: "state",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    state: FeatureState,
    @SlashOption({
      description: "Why (shown in the admin channel announcement)",
      name: "reason",
      required: false,
      type: ApplicationCommandOptionType.String,
      maxLength: FLAG_REASON_MAX,
    })
    rawReason: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const key = sanitizeUserInput(rawFeature, { preserveNewlines: false, allowUnderscore: true })
      .trim()
      .toLowerCase();
    const reason = sanitizeUserInput(rawReason ?? "", {
      preserveNewlines: false,
      allowUnderscore: true,
      maxLength: FLAG_REASON_MAX,
    }).trim();

    let text: string;
    try {
      text = await setFeatureFlagReply({
        actingUserId: interaction.user.id,
        key,
        state,
        reason: reason || null,
      });
    } catch (error: unknown) {
      const label = `Could not set the Feature Flag for \`${key}\` to ${state}`;
      await safeReply(interaction, buildErrorReply(buildApiErrorMessage(label, error), true));
      return;
    }
    await safeReply(interaction, buildTextReply(text, true));
  }
}
