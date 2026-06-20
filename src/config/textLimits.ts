// Discord API hard limits
export const DISCORD_SELECT_LABEL_MAX = 100;
export const DISCORD_SELECT_OPTIONS_MAX = 25;
export const DISCORD_EMBED_TITLE_MAX = 256;
export const DISCORD_EMBED_DESCRIPTION_MAX = 4096;
export const DISCORD_BUTTON_LABEL_MAX = 80;
export const DISCORD_CUSTOM_ID_MAX = 100;
export const DISCORD_MODAL_TITLE_MAX = 45;
export const DISCORD_TEXT_INPUT_MAX = 4000;

export const DISCORD_AUTOCOMPLETE_DESC_MAX = 95;
export const DISCORD_EMBED_FIELD_VALUE_MAX = 1024;

// Application-defined limits
export const MAX_QUERY_LENGTH = 50;
export const MAX_CONTAINER_TEXT = 3500;
export const MAX_SECTION_TEXT = 1000;

// Application-defined field limits
export const GIVEAWAY_MAX_TITLE_LENGTH    = 200;
export const GIVEAWAY_MAX_PLATFORM_LENGTH = 50;
export const GIVEAWAY_MAX_KEY_LENGTH      = 200;

export const truncateLabel = (s: string): string => s.slice(0, DISCORD_SELECT_LABEL_MAX);
export const truncateDescription = (s: string): string => s.slice(0, DISCORD_AUTOCOMPLETE_DESC_MAX);
