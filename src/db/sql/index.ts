import type { Dialect, SqlEntry } from "./types.js";

export type { Dialect, SqlEntry };

export { AdminWizardSessionSql } from "./adminWizardSession.sql.js";
export { BotVotingInfoSql } from "./botVotingInfo.sql.js";
export { CollectionCsvImportSql } from "./collectionCsvImport.sql.js";
export { CompletionatorImportSql } from "./completionatorImport.sql.js";
export { GameSql } from "./game.sql.js";
export { GameDbCsvImportSql } from "./gameDbCsvImport.sql.js";
export { GameDbCsvImportMappingSql } from "./gameDbCsvImportMapping.sql.js";
export { GameKeySql } from "./gameKey.sql.js";
export { GameReleaseAnnouncementSql } from "./gameReleaseAnnouncement.sql.js";
export {
  GameSearchSynonymSql,
  GameSearchSynonymDraftSql,
} from "./gameSearchSynonym.sql.js";
export { GotmSql, NrGotmSql } from "./gotm.sql.js";
export { GotmAuditImportSql } from "./gotmAuditImport.sql.js";
export { HltbCacheSql } from "./hltbCache.sql.js";
export { MemberSql } from "./member.sql.js";
export { NominationSql } from "./nomination.sql.js";
export {
  PresencePromptHistorySql,
  PresencePromptOptOutSql,
} from "./presencePrompt.sql.js";
export { ReminderSql, PublicReminderSql } from "./reminder.sql.js";
export { RssFeedSql } from "./rssFeed.sql.js";
export { StarboardSql } from "./starboard.sql.js";
export { SteamCollectionImportSql } from "./steamCollectionImport.sql.js";
export { SuggestionSql, SuggestionReviewSessionSql } from "./suggestion.sql.js";
export { ThreadSql } from "./thread.sql.js";
export { TodoSql } from "./todo.sql.js";
export {
  UserActivityIconSql,
  UserChannelMessageCountSql,
} from "./userActivity.sql.js";
export { UserGameCollectionSql } from "./userGameCollection.sql.js";
export { XboxCollectionImportSql } from "./xboxCollectionImport.sql.js";

/**
 * Selects the SQL string for the active dialect from a static SqlEntry.
 */
export function getSql(entry: SqlEntry, dialect: Dialect): string {
  return entry[dialect];
}

/**
 * Selects the SQL string for the active dialect from a factory-produced SqlEntry.
 */
export function getSqlDynamic(entry: SqlEntry, dialect: Dialect): string {
  return entry[dialect];
}
