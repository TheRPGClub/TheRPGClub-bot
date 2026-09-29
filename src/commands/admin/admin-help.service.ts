import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { ContainerBuilder } from "@discordjs/builders";
import { type AdminHelpTopic, type AdminHelpTopicId } from "./admin.types.js";
import { truncateDescription } from "../../config/textLimits.js";
import {
  buildTitledContainer,
  buildComponentsV2EditFlags,
  buildFieldsText,
} from "../../functions/ComponentsV2Utils.js";
import { buildSelectRow } from "../../functions/uiComponents.js";

export const ADMIN_HELP_TOPICS: AdminHelpTopic[] = [
  {
    id: "sync",
    label: "/admin sync",
    summary: "Refresh slash command registrations with Discord.",
    syntax: "Syntax: /admin sync",
    notes: "Use after updating command choices or definitions.",
  },
  {
    id: "add-gotm",
    label: "/admin add-gotm",
    summary: "Add the next GOTM round with guided prompts.",
    syntax: "Syntax: /admin add-gotm",
    notes:
      "Round number is auto-assigned to the next open round.",
  },
  {
    id: "edit-gotm",
    label: "/admin edit-gotm",
    summary: "Update details for a specific GOTM round.",
    syntax: "Syntax: /admin edit-gotm round:<integer>",
    parameters:
      "round (required) - GOTM round to edit. The bot shows current data and lets you pick what to change.",
  },
  {
    id: "add-nr-gotm",
    label: "/admin add-nr-gotm",
    summary: "Add the next NR-GOTM round with guided prompts.",
    syntax: "Syntax: /admin add-nr-gotm",
    notes:
      "Round number is auto-assigned to the next open NR-GOTM round.",
  },
  {
    id: "edit-nr-gotm",
    label: "/admin edit-nr-gotm",
    summary: "Update details for a specific NR-GOTM round.",
    syntax: "Syntax: /admin edit-nr-gotm round:<integer>",
    parameters:
      "round (required) - NR-GOTM round to edit. The bot shows current data and lets you pick what to change.",
  },
  {
    id: "delete-gotm-noms",
    label: "/admin delete-gotm-noms",
    summary: "Interactive panel to delete GOTM nominations.",
    syntax: "Syntax: /admin delete-gotm-noms",
    notes: "Shows the current nomination list, a title dropdown, and a required reason prompt. Submitting the modal deletes the nomination immediately.",
  },
  {
    id: "delete-nr-gotm-noms",
    label: "/admin delete-nr-gotm-noms",
    summary: "Interactive panel to delete NR-GOTM nominations.",
    syntax: "Syntax: /admin delete-nr-gotm-noms",
    notes: "Shows the current nomination list, a title dropdown, and a required reason prompt. Submitting the modal deletes the nomination immediately.",
  },
  {
    id: "set-nextvote",
    label: "/admin set-nextvote",
    summary: "Reschedule when voting opens for the current round.",
    syntax: "Syntax: /admin set-nextvote date:<date>",
    notes:
      "Votes are typically held the last Friday of the month. Date input is interpreted " +
      "in America/New_York, at noon. The close moves with it, keeping the weekend window.",
  },
  {
    id: "legacy-voting-setup",
    label: "/admin legacy-voting-setup",
    summary: "Build ready-to-paste Subo /poll commands from current nominations.",
    syntax: "Syntax: /admin legacy-voting-setup",
    notes:
      "Fallback for when first-party voting is unavailable. Pulls current nominations for " +
      "GOTM and NR-GOTM, sorts answers, and sets a sensible max_select. " +
      "Normal voting runs through /admin voting-open and /vote.",
  },
  {
    id: "voting-open",
    label: "/admin voting-open",
    summary: "Repost the voting panels for the round currently open for votes.",
    syntax:
      "Syntax: /admin voting-open [post-here:<bool>] [testmode:<bool>] [round:<number>]",
    notes:
      "Voting opens on schedule and the panels post on their own; use this to replace " +
      "missing panels while voting is open. They go to announcements (or the current " +
      "channel with post-here). testmode rehearses instead: panels are posted here only, " +
      "nothing is written, and round picks which round to rehearse. Casting from a test " +
      "panel is still a real vote.",
  },
  {
    id: "voting-close",
    label: "/admin voting-close",
    summary: "Close the open voting round early.",
    syntax: "Syntax: /admin voting-close",
    notes:
      "Moves the round's close to now. Either way the API decides the round and the " +
      "results and winner announcements post to announcements on their own.",
  },
  {
    id: "voting-results",
    label: "/admin voting-results",
    summary: "Show the GOTM and NR-GOTM vote tallies for a round.",
    syntax:
      "Syntax: /admin voting-results [round:<number>] [publish:<bool>] [channel:<channel>]",
    notes:
      "Defaults to the current round. Tallies stay hidden (totals only) until voting " +
      "ends, admins included. publish re-posts the results and winner announcements " +
      "to announcements after voting has ended. Adding channel rehearses that publish " +
      "in the named channel instead, with no winner thread created or renamed.",
  },
  {
    id: "votes-reset",
    label: "/admin votes-reset",
    summary: "Delete all first-party votes for a round and category.",
    syntax: "Syntax: /admin votes-reset type:<GOTM|NR-GOTM> round:<number>",
    notes: "Asks for confirmation. This cannot be undone.",
  },
];

/**
 * Help topic ids renamed over time. A help menu posted before a rename still
 * carries the old id as its select value, so resolving through this keeps those
 * messages working instead of falling back to the error path.
 */
const ADMIN_HELP_TOPIC_ALIASES: Record<string, AdminHelpTopicId> = {
  "voting-setup": "legacy-voting-setup",
};

/** Finds a help topic by id, accepting ids from before a rename. */
export function resolveAdminHelpTopic(value: string | undefined): AdminHelpTopic | undefined {
  if (!value) {
    return undefined;
  }
  const id = ADMIN_HELP_TOPIC_ALIASES[value] ?? value;
  return ADMIN_HELP_TOPICS.find((topic) => topic.id === id);
}

export function buildAdminHelpButtons(
  activeId?: AdminHelpTopicId,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    // eslint-disable-next-line local/custom-id-has-matching-handler
    .setCustomId("admin-help-select")
    .setPlaceholder("/admin help")
    .addOptions(
      ADMIN_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: truncateDescription(topic.summary),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [buildSelectRow(select)];
}

export function buildAdminHelpEmbed(topic: AdminHelpTopic): ContainerBuilder {
  const fields = [{ name: "Syntax", value: topic.syntax }];
  if (topic.parameters) fields.push({ name: "Parameters", value: topic.parameters });
  if (topic.notes) fields.push({ name: "Notes", value: topic.notes });
  const body = [topic.summary, buildFieldsText(fields)].join("\n\n");
  return buildTitledContainer(`${topic.label} help`, body);
}

export function buildAdminHelpResponse(
  activeTopicId?: AdminHelpTopicId,
): {
  components: (ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>)[];
  flags: number;
} {
  const container = buildTitledContainer(
    "Admin Commands Help",
    "Pick an `/admin` command below to see what it does and how to use it.",
  );
  const actionRows = buildAdminHelpButtons(activeTopicId);

  return {
    components: [container, ...actionRows],
    flags: buildComponentsV2EditFlags(),
  };
}
