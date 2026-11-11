import type { NewsCategoryKey } from "./newsHub.js";

// The News Category rules: data only, read by the category picker
// (src/functions/NewsCategoryPicker.ts). Refreshing the rules edits this file and nothing else.
// Seeded from the classifier feasibility study of spec api#367 (version 3: 21 rules, about 79%
// agreement with the classified News Import on 2025-2026 posts).
//
// Ordered: the first rule that matches a post wins, and a post no rule matches goes to General.
// `in` says where to look:
// - "empty_url": the post has no link (images or a comment only).
// - "domain": the link's host or a parent domain, or, for an entry with a slash, an account
//   or community: `x.com/<account>`, `bsky.app/<handle>`, `reddit.com/<community>`.
// - places joined with "+": "url" (the words of the link's path), "title", "comment",
//   "desc" (the page description), "head" (title and comment, plus the description for a
//   social post or a page with no title), "text" (title, description and comment).
// A rule with both `domains` and `any` needs both. Phrases match at word starts ("leak" also
// hits "leaked"); a trailing space means a whole word only. Case and punctuation are ignored.

/** A place a phrase is looked for. */
export type NewsRuleField = "url" | "title" | "comment" | "desc" | "head" | "text";

type NewsRulePlaces =
  | NewsRuleField
  | `${NewsRuleField}+${NewsRuleField}`
  | `${NewsRuleField}+${NewsRuleField}+${NewsRuleField}`;

interface INewsRuleBase {
  category: NewsCategoryKey;
  /** Why the rule exists, for whoever refreshes the rules. */
  note: string;
}

export type NewsCategoryRule = INewsRuleBase & (
  | { in: "empty_url" }
  | { in: "domain"; domains: readonly string[] }
  | { in: NewsRulePlaces; any: readonly string[]; domains?: readonly string[] }
);

export const NEWS_CATEGORY_RULES: readonly NewsCategoryRule[] = [
  {
    category: "general",
    in: "empty_url",
    note: "image or text post, no link",
  },
  {
    category: "emulation",
    in: "domain",
    note: "emulation sites",
    domains: [
      "geofront.esterior.net", "x.com/geofrontteam", "github.com", "romhacking.net",
      "archive.org", "gamehistory.org", "x.com/gamehistoryorg", "reddit.com/emulation",
      "retroachievements.org", "libretro.com",
    ],
  },
  {
    category: "emulation",
    in: "url+text",
    note: "emulation phrases",
    any: [
      "emulat", "decomp", "recomp", "fan translat", "english patch", "translation patch",
      "fan patch", "rom hack", "romhack", "homebrew", "preservation", "abandonware", "retroarch",
      "ryujinx", "pcsx2", "rpcs3", "duckstation", "fan made ", "unofficial patch",
    ],
  },
  {
    category: "emulation",
    in: "url+head",
    note: "mods",
    any: [
      "mod ", "mods ", "yuzu", "source code",
    ],
  },
  {
    category: "rumours",
    in: "domain",
    note: "leak sources",
    domains: [
      "reddit.com/gamingleaksandrumours", "dealabs.com", "x.com/scrambledfaz",
      "x.com/mbkksstbhz5", "x.com/centroleaks", "x.com/billbil_kun", "x.com/nate_the_hate",
    ],
  },
  {
    category: "rumours",
    in: "url+text",
    note: "rumour words",
    any: [
      "leak", "rumor", "rumour", "reportedly", "datamin", "trademark", "allegedly",
    ],
  },
  {
    category: "rumours",
    in: "url+head",
    note: "listings and hedging",
    any: [
      "insider", "listing", "listed on", "speculat", "grain of salt", "pinch of salt",
      "sources say", "vgc", "report",
    ],
  },
  {
    category: "rumours",
    in: "url+text",
    note: "ratings boards",
    any: [
      "has rated", "been rated", "rated in", "rated for", "rating board", "ratings board",
      "age rating", "game rating", "rating committee", "retailer list",
    ],
  },
  {
    category: "industry",
    in: "domain",
    note: "business outlets",
    domains: [
      "gamesindustry.biz", "gamedeveloper.com", "x.com/jasonschreier",
      "bsky.app/jasonschreier.bsky.social", "x.com/genki_jpn", "bloomberg.com", "venturebeat.com",
      "x.com/stephentotilo", "delistedgames.com",
    ],
  },
  {
    category: "industry",
    in: "url+text",
    note: "business, sales, closures",
    any: [
      "layoff", "laid off", "lays off", "acquisition", "merger", "earnings", "revenue",
      "shareholder", "units sold", "million units", "copies sold", "units worldwide", "has sold",
      "sales top", "sales ", "shipments", "surpass", "famitsu sales", "circana", "nft",
      "blockchain", "establishes", "establishment", "shut down", "shutting down", "shuts down",
      "closure",
    ],
  },
  {
    category: "industry",
    in: "url+head",
    note: "people and legal",
    any: [
      "acquir", "financial", "fiscal", "best selling", "ceo ", "leaves ", "has left",
      "steps down", "lawsuit", "court", "closing", "end service", "end of service", "new studio",
      "embracer", "business", "live service", "antitrust", "president", "statement",
    ],
  },
  {
    category: "hardware",
    in: "domain",
    note: "platform outlets",
    domains: [
      "news.xbox.com", "x.com/xboxgamepass", "x.com/delistedgames", "theverge.com",
      "gamingonlinux.com", "techspot.com",
    ],
  },
  {
    category: "hardware",
    in: "url+text",
    note: "subscriptions and services",
    any: [
      "playstation plus", "ps plus", "switch online", "nintendoswitchonline", "expansion pack",
      "catalog lineup", "game catalog", "monthly games", "xbox cloud", "cloud gaming",
      "geforce now", "playstation portal", "playstation stars", "system software",
      "playstation vr", "vr2",
    ],
  },
  {
    category: "hardware",
    in: "url+head",
    note: "devices and platforms",
    any: [
      "game pass", "gamepass", "steam deck", "handheld", "ps5 pro", "controller", "firmware",
      "system update", "backward compat", "delist", "wii u", "3ds ", "ps3 ", "joy con",
      "ps extra", "ps essential", "ps premium", "humble choice", "fps boost",
    ],
  },
  {
    category: "releases",
    in: "domain",
    note: "review aggregators",
    domains: [
      "opencritic.com", "metacritic.com", "reddit.com/games",
    ],
  },
  {
    category: "releases",
    in: "url+text",
    note: "launch and update",
    any: [
      "now available", "out now", "is out ", "out today", "now out", "launches today",
      "launched today", "available today", "launch trailer", "release trailer",
      "accolades trailer", "critics", "metascore", "opencritic", "update now", "update adds",
      "update which", "update available", "which adds", "patch notes", "demo now", "demo is now",
      "demo out",
    ],
  },
  {
    category: "releases",
    in: "url+head",
    note: "review, patch, sale",
    any: [
      "review", "patch", "version 1", "update for", "free update", "update is", "now live",
      "sale ", "percent off", "restock", "eshop",
    ],
  },
  {
    category: "general",
    in: "url+head",
    note: "culture and off-topic",
    any: [
      "film ", "movie", "live action", "netflix", "tv series", "anime", "concert", "survey",
      "figure ", "plush", "vinyl", "passed away", "anniversary website", "passes away", "nominee",
      "winners",
    ],
  },
  {
    category: "announcements",
    in: "domain",
    note: "announcement-heavy sources",
    domains: [
      "gematsu.com", "youtube.com", "noisypixel.net", "siliconera.com", "rpgsite.net",
      "turnbasedlovers.com", "x.com/gematsu", "x.com/gematsucom", "bsky.app/gematsu.com",
      "x.com/noisypixelnews", "x.com/nintendoamerica", "x.com/nisamerica", "x.com/atlus_west",
      "x.com/rggstudio", "x.com/ideafactoryintl", "x.com/playstation", "x.com/rpgsite",
    ],
  },
  {
    category: "announcements",
    in: "url+text",
    note: "announcement words",
    any: [
      "announc", "reveal", "trailer", "teaser", "teases", "gameplay", "showcase", "direct ",
      "state of play", "release date", "launches ", "coming to", "coming west", "coming soon",
      "comes to", "headed to", "in development", "preview", "hands on", "first look", "details",
      "screenshots", "new character", "debut", "pre order", "preorder", "demo", "beta", "delay",
      "localized", "western release", "for switch", "for ps5", "for ps4", "for pc", "for xbox",
      "tokyo game show", "gamescom",
    ],
  },
  {
    category: "general",
    in: "domain",
    note: "misc and meme sources",
    domains: [
      "x.com/finalfantasy", "x.com/nxonnetflix", "pbs.twimg.com", "tenor.com", "imgur.com",
      "cdn.discordapp.com", "media.discordapp.net",
    ],
  },
];
