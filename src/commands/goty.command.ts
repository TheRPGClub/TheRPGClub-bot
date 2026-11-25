import { Discord, SlashGroup } from "discordx";

// /goty (spec api#471): the GOTY Vote in Discord. This class only declares the root
// command; each part adds its own subcommand in commands/goty/goty-<name>.command.ts,
// declaring `@SlashGroup("goty")`, and is re-exported below:
// - vote (bot#1581): a ballot panel per Award.
// - nominate, nominations, results (bot#1580).
// Their components share the `goty-` custom id prefix (config/customIdPrefixes.ts), and the
// whole command belongs to the goty_vote Feature (config/featureGate.ts). Every part calls
// the API through services/GotyVoteApi.ts.

@Discord()
@SlashGroup({
  name: "goty",
  description: "The yearly GOTY Vote: nominate, vote and see the winners",
})
export class GotyCommand {}

export { GotyVoteCommand } from "./goty/goty-vote.command.js";
export { GotyNominateCommand } from "./goty/goty-nominate.command.js";
export { GotyNominationsCommand } from "./goty/goty-nominations.command.js";
export { GotyResultsCommand } from "./goty/goty-results.command.js";
