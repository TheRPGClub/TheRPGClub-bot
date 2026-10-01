import { IS_TEST_MODE, TEST_GUILD_ID } from "./testMode.js";

/** The RPG Club guild, or the private test guild when test mode is on. */
export const HOME_GUILD_ID: string = IS_TEST_MODE ? TEST_GUILD_ID : "191941851757019136";
