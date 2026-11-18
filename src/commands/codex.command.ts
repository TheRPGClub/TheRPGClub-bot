import { Discord, SlashGroup } from "discordx";

// /codex (spec api#397): the Club Codex in Discord. This class only declares the root
// command; each part adds its own subcommand group (or subcommand) in commands/codex/,
// declaring `root: "codex"`, and is re-exported below. The whole command belongs to the
// club_codex Feature (config/featureGate.ts).

@Discord()
@SlashGroup({
  name: "codex",
  description: "The Club Codex: the club's history, lore and Fun Facts",
})
export class CodexCommand {}

export { CodexFunFactCommand } from "./codex/codex-fun-fact.command.js";
