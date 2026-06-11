import {
  type ActionRowBuilder,
  type StringSelectMenuBuilder,
  type ButtonBuilder,
} from "discord.js";
import {
  type ContainerBuilder,
  type MediaGalleryBuilder,
} from "@discordjs/builders";
import { type CompletionType } from "../profile.command.js";

export type NowPlayingAddSession = {
  userId: string;
  query: string;
  note: string | null;
  timeoutId?: ReturnType<typeof setTimeout>;
};

export type NowPlayingAddPlatformSession = {
  userId: string;
  gameId: number;
  note: string | null;
  sourceSessionId: string;
};

export type NowPlayingCompletionWizardSession = {
  userId: string;
  gameId: number | null;
  completionType: CompletionType;
  removeFromNowPlaying: boolean;
  announce: boolean;
  addCompletionNote: boolean;
  returnToList: boolean;
};

export type NowPlayingCompletionPlatformSession = {
  sessionId: string;
  userId: string;
  gameId: number;
  completionType: CompletionType;
  completedAt: Date | null;
  finalPlaytimeHours: number | null;
  note: string | null;
  removeFromNowPlaying: boolean;
  announce: boolean;
  returnToList: boolean;
  platforms: Array<{ id: number; name: string }>;
};

export type NowPlayingTrackedView = "single" | "everyone" | "everyone-selected";

export type NowPlayingListContext = {
  channelId: string;
  messageId: string;
  createdAt: number;
  view: NowPlayingTrackedView;
  ownerUserId: string | null;
  selectedUserId: string | null;
};

export type NowPlayingJournalContext = {
  channelId: string;
  messageId: string;
  createdAt: number;
  ownerUserId: string;
  gameId: number;
};

export type NowPlayingMessageComponents = Array<
  | ContainerBuilder
  | MediaGalleryBuilder
  | ActionRowBuilder<ButtonBuilder>
  | ActionRowBuilder<StringSelectMenuBuilder>
>;

export type NowPlayingListComponents = ContainerBuilder[];

export type NowPlayingPayloadComponents = Array<
  ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>
>;
