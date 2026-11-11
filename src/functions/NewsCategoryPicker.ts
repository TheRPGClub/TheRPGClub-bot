import {
  NEWS_CATEGORY_RULES,
  type NewsCategoryRule,
  type NewsRuleField,
} from "../config/newsCategoryRules.js";
import type { NewsCategoryKey } from "../config/newsHub.js";
import type { INewsLinkPayload } from "./NewsItem.js";

// The free category picker (spec api#367, "Category picker"): ordered keyphrase rules from a
// data file shipped in the bot (src/config/newsCategoryRules.ts, which describes their shape),
// first match wins, no match goes to General. Refreshing the rules only edits that file.

/** What the picker reads from a News Item: its link and Discord's preview, and the comment. */
export interface INewsCategoryPost {
  /** The site name is not matched: domains cover the site, and it scored nothing extra. */
  link: Pick<INewsLinkPayload, "url" | "title" | "site_name" | "description"> | null;
  comment: string | null;
}

const FALLBACK: NewsCategoryKey = "general";

/** A rule ready to match: phrases and domains in the form the post's text is in. */
interface ICompiledRule {
  category: NewsCategoryKey;
  /** Matches only a post with no link; nothing else is checked. */
  noLink: boolean;
  domains: readonly string[];
  fields: readonly NewsRuleField[];
  phrases: readonly string[];
}

/** Addresses that show another site's posts: matched as that site. */
const MIRRORS: Readonly<Record<string, string>> = {
  "twitter.com": "x.com",
  "mobile.twitter.com": "x.com",
  "fxtwitter.com": "x.com",
  "vxtwitter.com": "x.com",
  "fixupx.com": "x.com",
  "bskyx.app": "bsky.app",
  "youtu.be": "youtube.com",
  "m.youtube.com": "youtube.com",
  "old.reddit.com": "reddit.com",
};

/** Sites whose preview description is the post itself, so it counts like a title. */
const SOCIAL_HOSTS = new Set([
  "x.com",
  "bsky.app",
  "reddit.com",
  "t.co",
  "threads.net",
  "mastodon.social",
]);

/** Lower-case words separated by single spaces, with a space at each end. */
function words(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** A phrase matches at a word start; a trailing space (or `$`) makes it a whole word. */
function phrasePattern(phrase: string): string {
  const pattern = ` ${phrase.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
  return phrase.endsWith(" ") || phrase.endsWith("$") ? `${pattern} ` : pattern;
}

function compile(rule: NewsCategoryRule): ICompiledRule {
  const noLink = rule.in === "empty_url";
  const phrases = "any" in rule ? rule.any : [];
  const fields = noLink || rule.in === "domain" ? "" : rule.in;
  return {
    category: rule.category,
    noLink,
    domains: ("domains" in rule ? rule.domains ?? [] : []).map((domain) => domain.toLowerCase()),
    fields: fields.split("+").filter(Boolean) as NewsRuleField[],
    phrases: phrases.map(phrasePattern),
  };
}

const RULES = NEWS_CATEGORY_RULES.map(compile);

/** What the rules look at in a post, each in {@link words} form. */
interface IPostText extends Record<NewsRuleField, string> {
  hasLink: boolean;
  host: string;
  account: string;
}

interface IAddress {
  host: string;
  /** Path, query and fragment: the words a URL rule looks at. */
  path: string;
  account: string;
}

/** `x.com/<account>`, `bsky.app/<handle>` or `reddit.com/<community>`; else the host. */
function accountOf(host: string, pathname: string): string {
  const [first, second] = pathname.toLowerCase().split("/").filter(Boolean);
  if (host === "x.com" && first) return `x.com/${first}`;
  if ((host === "bsky.app" || host === "reddit.com") && second) return `${host}/${second}`;
  return host;
}

function parseAddress(address: string): IAddress {
  try {
    const url = new URL(address);
    const bare = url.hostname.toLowerCase().replace(/^www\./, "");
    const host = MIRRORS[bare] ?? bare;
    const path = `${url.pathname}${url.search}${url.hash}`;
    return { host, path, account: accountOf(host, url.pathname) };
  } catch {
    return { host: "", path: address, account: "" };
  }
}

function postText(post: INewsCategoryPost): IPostText {
  const address = post.link?.url.trim() ?? "";
  const title = post.link?.title ?? "";
  const desc = post.link?.description ?? "";
  const comment = post.comment ?? "";
  const { host, path, account } = parseAddress(address);
  const descIsHead = SOCIAL_HOSTS.has(host) || title.trim() === "";
  return {
    hasLink: address !== "",
    host,
    account,
    url: words(path),
    title: words(title),
    comment: words(comment),
    desc: words(desc),
    head: words([title, comment, ...(descIsHead ? [desc] : [])].join(" . ")),
    text: words([title, desc, comment].join(" . ")),
  };
}

/** A domain with a slash is an account; otherwise the host or one of its subdomains. */
function isOn(text: IPostText, domain: string): boolean {
  if (domain.includes("/")) return text.account === domain;
  return text.host === domain || text.host.endsWith(`.${domain}`);
}

function matches(rule: ICompiledRule, text: IPostText): boolean {
  if (rule.noLink) return !text.hasLink;
  if (rule.domains.length > 0 && !rule.domains.some((domain) => isOn(text, domain))) {
    return false;
  }
  return rule.phrases.length === 0 ||
    rule.fields.some((field) => rule.phrases.some((phrase) => text[field].includes(phrase)));
}

/**
 * The News Category for a post: the first rule in the data file that matches it, or General.
 * Pure: a News Item payload is a valid `post`, with or without Discord's preview yet.
 */
export function pickNewsCategory(post: INewsCategoryPost): NewsCategoryKey {
  const text = postText(post);
  return RULES.find((rule) => matches(rule, text))?.category ?? FALLBACK;
}
