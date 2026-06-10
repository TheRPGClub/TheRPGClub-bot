import { type MessageCreateOptions, type TextBasedChannel, userMention } from "discord.js";
import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import type { Client } from "discordx";

import { DISCORD_CONSOLE_LOG_CHANNEL_ID } from "../config/channels.js";
import { BOT_DEV_PING_USER_ID } from "../config/users.js";
import { buildComponentsV2EditFlags, safeV2TextContent } from "../functions/ComponentsV2Utils.js";
import {
  COLOR_INFO,
  COLOR_WARNING,
  COLOR_ERROR,
  COLOR_NEUTRAL,
  COLOR_PURPLE,
} from "../config/colors.js";
const MAX_DESCRIPTION_LENGTH = 3900;
const LEVEL_COLORS: Record<string, number> = {
  log: COLOR_NEUTRAL,
  info: COLOR_INFO,
  warn: COLOR_WARNING,
  error: COLOR_ERROR,
  debug: COLOR_PURPLE,
};
const LOG_BATCH_INTERVAL_MS = 5 * 1000;
const LOG_BATCH_MAX_CHARS = 2600;
const STARTUP_COMPLETE_LOG = "Startup sequence completed.";
const STARTUP_ALLOWED_LOG_PATTERNS: RegExp[] = [
  /^bot >> connecting discord\.\.\.$/i,
  /^RPGClub GameDB >> commands >> global$/,
  /^>> adding\s+\d+\s+\[.*\]$/,
  /^>> deleting\s+\d+\s+\[.*\]$/,
  /^>> skipping\s+\d+\s+\[.*\]$/,
  /^>> updating\s+\d+\s+\[.*\]$/,
  /^\[ThreadSync\] Service started$/,
  /^\[ThreadLinkPrompt\] Service started$/,
  /^Startup sequence completed\.$/,
];

type ConsoleLevel = "log" | "error" | "warn" | "info" | "debug";
type BufferedLevel = ConsoleLevel;
type BufferedLogEntry = { time: number; message: string };

const originalConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
};

type ILoggerChannel = TextBasedChannel & { send: (options: MessageCreateOptions) =>
  Promise<unknown> };

let discordClient: Client | null = null;
let logChannel: ILoggerChannel | null = null;
let resolvingChannel = false;
const logBuffer: Record<BufferedLevel, BufferedLogEntry[]> = {
  log: [],
  info: [],
  warn: [],
  error: [],
  debug: [],
};
const logBufferCharCount: Record<BufferedLevel, number> = {
  log: 0,
  info: 0,
  warn: 0,
  error: 0,
  debug: 0,
};
let logBufferTimer: NodeJS.Timeout | null = null;
let startupLogFilterEnabled = true;
let shutdownHooksRegistered = false;

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.stack ?? a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

function isAllowedStartupLog(message: string): boolean {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (!lines.length) return false;
  return lines.every((line) =>
    STARTUP_ALLOWED_LOG_PATTERNS.some((pattern) => pattern.test(line)),
  );
}

function shouldSendToDiscord(level: ConsoleLevel, message: string): boolean {
  if (!startupLogFilterEnabled) return true;
  if (isAllowedStartupLog(message)) {
    if (message.includes(STARTUP_COMPLETE_LOG)) {
      startupLogFilterEnabled = false;
    }
    return true;
  }
  return false;
}

async function ensureChannel(): Promise<ILoggerChannel | null> {
  if (!discordClient) return null;
  if (logChannel) return logChannel;
  if (resolvingChannel) return logChannel;

  resolvingChannel = true;
  try {
    const channel = await discordClient.channels.fetch(DISCORD_CONSOLE_LOG_CHANNEL_ID)
      .catch(() => null);
    const sendable = channel as { send?: unknown } | null;
    if (channel && channel.isTextBased() && typeof sendable?.send === "function") {
      logChannel = channel as ILoggerChannel;
    }
  } finally {
    resolvingChannel = false;
  }

  return logChannel;
}

function buildLogContainer(level: BufferedLevel, description: string): ContainerBuilder {
  const timestamp = Math.floor(Date.now() / 1000);
  return new ContainerBuilder()
    .setAccentColor(LEVEL_COLORS[level])
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        safeV2TextContent(`\`\`\`\n${description}\`\`\``, MAX_DESCRIPTION_LENGTH),
      ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(`-# <t:${timestamp}:T>`, 100)),
    );
}

async function sendContainerToChannel(
  channel: ILoggerChannel,
  container: ContainerBuilder,
  content?: string,
): Promise<void> {
  await channel.send({
    components: [container],
    flags: buildComponentsV2EditFlags(),
    ...(content ? { content } : {}),
  });
}

function getBufferedLine(level: BufferedLevel, message: string): string {
  if (level === "log") {
    return message;
  }

  return `[${level.toUpperCase()}] ${message}`;
}

function startLogBufferTimer(): void {
  if (logBufferTimer) return;
  logBufferTimer = setInterval(() => void flushLogBuffer(), LOG_BATCH_INTERVAL_MS);
}

function stopLogBufferTimerIfIdle(): void {
  if (
    logBuffer.log.length > 0 ||
    logBuffer.info.length > 0 ||
    logBuffer.warn.length > 0 ||
    logBuffer.error.length > 0 ||
    logBuffer.debug.length > 0
  ) {
    return;
  }
  if (!logBufferTimer) return;
  clearInterval(logBufferTimer);
  logBufferTimer = null;
}

async function flushLogBuffer(targetLevel?: BufferedLevel): Promise<void> {
  const levelsToFlush: BufferedLevel[] = targetLevel
    ? [targetLevel]
    : ["log", "info", "warn", "error", "debug"];
  const hasLogs = levelsToFlush.some((level) => logBuffer[level].length > 0);
  if (!hasLogs) {
    stopLogBufferTimerIfIdle();
    return;
  }

  const channel = await ensureChannel();
  if (!channel) {
    stopLogBufferTimerIfIdle();
    return;
  }

  try {
    for (const level of levelsToFlush) {
      if (logBuffer[level].length === 0) continue;
      const logsToSend = [...logBuffer[level]].sort((a, b) => a.time - b.time);
      logBuffer[level] = [];
      logBufferCharCount[level] = 0;

      let currentDescription = "";
      const containers: ContainerBuilder[] = [];

      for (const item of logsToSend) {
        const line = item.message;
        const nextLine = `${line}\n`;
        if (currentDescription.length + nextLine.length > MAX_DESCRIPTION_LENGTH - 8) {
          containers.push(buildLogContainer(level, currentDescription));
          currentDescription = "";
        }

        currentDescription += nextLine;
      }

      if (currentDescription.length > 0) {
        containers.push(buildLogContainer(level, currentDescription));
      }

      const pingContent = level === "error" ? userMention(BOT_DEV_PING_USER_ID) : undefined;
      for (let i = 0; i < containers.length; i++) {
        await sendContainerToChannel(channel, containers[i], i === 0 ? pingContent : undefined);
      }
    }
  } catch {
    // Swallow to avoid recursive console logging on failures
  } finally {
    stopLogBufferTimerIfIdle();
  }
}

function bufferLog(level: BufferedLevel, message: string): void {
  const line = getBufferedLine(level, message);
  logBuffer[level].push({ message: line, time: Date.now() });
  logBufferCharCount[level] += line.length + 1;
  startLogBufferTimer();

  if (logBufferCharCount[level] >= LOG_BATCH_MAX_CHARS) {
    void flushLogBuffer(level);
  }
}

function registerLogBufferShutdownHooks(): void {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;

  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGBREAK"];
  for (const signal of signals) {
    process.once(signal, () => {
      void flushLogBuffer();
    });
  }

  process.once("beforeExit", () => {
    void flushLogBuffer();
  });
}

async function sendToDiscord(level: ConsoleLevel, message: string): Promise<void> {
  try {
    if (!shouldSendToDiscord(level, message)) {
      return;
    }

    // Filter out noisy Discord client acknowledgement errors
    if (
      level === "error" &&
      message.includes("Discord client error:") &&
      (message.includes("DiscordAPIError[40060]") || message.includes("DiscordAPIError[10062]"))
    ) {
      return;
    }

    // Suppress PostgreSQL idle-connection drops until PG is actively used
    if (level === "error" && message.includes("[PostgreSQL] Unexpected client error:")) {
      return;
    }

    // Suppress routine IGDB scan progress logs; only surface errors
    if (level !== "error" && message.includes("[IGDB Scan]")) {
      return;
    }

    // Suppress individual slash command invocation logs
    if (level === "log" && message.includes("[SlashCommand]")) {
      return;
    }

    bufferLog(level, message);
    return;
  } catch {
    // Swallow to avoid recursive console logging on failures
  }
}

export function installConsoleLogging(): void {
  const levels: ConsoleLevel[] = ["log", "error", "warn", "info", "debug"];
  registerLogBufferShutdownHooks();

  for (const level of levels) {
    console[level] = (...args: unknown[]) => {
      const msg = formatArgs(args);
      originalConsole[level](...args);
      void sendToDiscord(level, msg);
    };
  }
}

export function setConsoleLoggingClient(client: Client): void {
  discordClient = client;
}

export async function logToDiscord(message: string, level: ConsoleLevel = "log"): Promise<void> {
  const msg = formatArgs([message]);
  await sendToDiscord(level, msg);
}
