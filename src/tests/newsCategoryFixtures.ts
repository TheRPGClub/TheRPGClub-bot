import type { NewsCategoryKey } from "../config/newsHub.js";

/**
 * Real posts from the classified News Import (2025-2026), trimmed: mentions dropped and
 * long descriptions cut. Each keeps the category staff gave it and the rule that finds it,
 * so a rules refresh that loses a known case fails a test.
 */
export interface INewsCategoryFixture {
  category: NewsCategoryKey;
  /** What finds it, for the test name. */
  via: string;
  url: string | null;
  title?: string;
  siteName?: string;
  description?: string;
  comment?: string;
}

export const NEWS_CATEGORY_FIXTURES: readonly INewsCategoryFixture[] = [
  {
    category: "announcements",
    via: "an announcement-heavy site",
    url: "https://www.youtube.com/watch?v=E9DUNj4M0vk",
    title: "FRONT MISSION 3: Remake || Nintendo Switch Date Announcement Trailer",
    siteName: "YouTube",
    comment: "june 26",
  },
  {
    category: "announcements",
    via: "an announcement word in a Bluesky post, through a mirror",
    url: "https://bskyx.app/profile/wario64.bsky.social/post/3lkbdfnhise2p",
    title: "Wario64 (@wario64.bsky.social)",
    siteName: "VixBluesky",
    description: "PowerWash Simulator 2 announced (self published by FuturLab, coming 2025)",
  },
  {
    category: "releases",
    via: "a review aggregator",
    url: "https://opencritic.com/game/18399/mafia-the-old-country",
    title: "Mafia: The Old Country Reviews",
    siteName: "OpenCritic",
    comment: "reviews are out and looking good",
  },
  {
    category: "releases",
    via: "a launch phrase before the YouTube rule",
    url: "https://www.youtube.com/watch?v=SN_jHxgl9sc",
    title: "Entropy Demo + Early Access Release Date Trailer",
    siteName: "YouTube",
    description: "The demo for Entropy is out now! Launching into Early Access on August 18th!",
  },
  {
    category: "releases",
    via: "patch in the title",
    url: "https://steamcommunity.com/games/1145350/announcements/detail/521992119019110975",
    title: "Steam :: Hades II :: Post-Launch Patch 2 Notes",
  },
  {
    category: "emulation",
    via: "an emulation site",
    url: "https://github.com/Roman215/Weltall",
    title: "GitHub - Roman215/Weltall: An Unreal Engine port of Xenogears with ...",
    siteName: "GitHub",
    comment: "we are so back xeno fans. Xenogears ported to Unreal5",
  },
  {
    category: "emulation",
    via: "fan translation in the title",
    url: "https://www.reddit.com/r/digimon/s/ZIpalrqj4X",
    title: "Digimon Universe: Appli Monsters (3DS) English Fan Translation",
  },
  {
    category: "emulation",
    via: "mod in the title",
    url: "https://www.pcgamer.com/games/rpg/you-can-download-planescape-torments-unofficial-dlc-mod-right-now/",
    title: "You can download Planescape: Torment's unofficial DLC mod right now",
    siteName: "PC Gamer",
    description: "Cania believe it?",
  },
  {
    category: "industry",
    via: "a business reporter's Bluesky account, through a mirror",
    url: "https://bskyx.app/profile/jasonschreier.bsky.social/post/3lizk5skwps2d",
    title: "Jason Schreier (@jasonschreier.bsky.social)",
    siteName: "VixBluesky",
    description: "BREAKING: Warner Bros. Games is shutting down Monolith Productions",
  },
  {
    category: "industry",
    via: "a closure",
    url: "https://noisypixel.net/edge-of-eternity-midgar-studio-shuts-down-liquidation/",
    title: "Edge Of Eternity Developer Midgar Studio Shuts Down After Court-Ord...",
    siteName: "Noisy Pixel",
  },
  {
    category: "industry",
    via: "a company president",
    url: "https://www.gematsu.com/2025/01/nippon-ichi-software-president-tetsuhisa-seko-dies-at-age-54",
    title: "Nippon Ichi Software president Tetsuhisa Seko dies at age 54",
    siteName: "Gematsu",
  },
  {
    category: "hardware",
    via: "a platform outlet",
    url: "https://www.theverge.com/games/974544/microsoft-xbox-360-games-pc-disc-digital-program",
    title: "Microsoft is bringing Xbox 360 games to PC",
    siteName: "The Verge",
    comment: "perhaps Blue Dragon Lost Odyssey native ports?",
  },
  {
    category: "hardware",
    via: "a subscription service in a Bluesky post",
    url: "https://bsky.app/profile/wario64.bsky.social/post/3lhkfoliz3r2b",
    description: "Wario Land 4 comes to Switch Online + Expansion Pack on Feb 14th",
  },
  {
    category: "hardware",
    via: "the link address alone, before the preview",
    url: "https://www.gematsu.com/2026/07/xbox-backward-compatibility-on-pc-announced-four-titles-now-available",
  },
  {
    category: "rumours",
    via: "a leaks community",
    url: "https://old.reddit.com/r/GamingLeaksAndRumours/comments/1jtcjcr/several_switch_dev_builds_has_leaked_from_devkit/",
    title: "From the GamingLeaksAndRumours community on Reddit: Several switch ...",
    siteName: "Reddit",
  },
  {
    category: "rumours",
    via: "a leak",
    url: "https://www.notebookcheck.net/A-glowing-Avowed-review-leaks-ahead-of-tomorrow-s-embargo-date.960188.0.html",
    title: "A glowing Avowed review leaks ahead of tomorrow's embargo date",
    siteName: "Notebookcheck",
    comment: "Leaked review of Avowed. 9.5/10.",
  },
  {
    category: "rumours",
    via: "a ratings board",
    url: "https://www.gematsu.com/2026/03/devil-may-cry-5-devil-hunter-edition-rated-for-switch-2-in-taiwan",
    title: "Devil May Cry 5 Devil Hunter Edition rated for Switch 2 in Taiwan",
    siteName: "Gematsu",
  },
  {
    category: "general",
    via: "images and a comment, no link",
    url: null,
    comment: "Sheeeeesh",
  },
  {
    category: "general",
    via: "a live-action series before the Gematsu rule",
    url: "https://www.gematsu.com/2026/06/variety-persona-live-action-series-in-development-at-netflix",
    title: "Variety: Persona live-action series in development at Netflix",
    siteName: "Gematsu",
  },
  {
    category: "general",
    via: "an image host",
    url: "https://media.discordapp.net/attachments/413796615384596491/1384565004610830468/image.png",
  },
  {
    category: "general",
    via: "no rule (the fallback)",
    url: "https://www.reddit.com/r/FinalFantasy/s/QTb9uYhZcT",
    title: "Travis Willingham will be replacing Tyler Hoechlin as the voice of ...",
  },
];
