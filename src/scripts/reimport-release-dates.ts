import "dotenv/config";
import { initOraclePool, getOraclePool } from "../db/oracleClient.js";
import { oraQuery, oraMutate } from "../db/SqlManager.js";
import Game from "../classes/Game.js";

type ScriptMode = "dry-run" | "write";

interface IGameWithIgdb {
  gameId: number;
  title: string;
  igdbId: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function getGamesWithIgdbIds(): Promise<IGameWithIgdb[]> {
  return oraQuery(
    `SELECT GAME_ID, TITLE, IGDB_ID
       FROM GAMEDB_GAMES
      WHERE IGDB_ID IS NOT NULL
      ORDER BY GAME_ID`,
    {},
    (row: { GAME_ID: number; TITLE: string; IGDB_ID: number }) => ({
      gameId: Number(row.GAME_ID),
      title: String(row.TITLE),
      igdbId: Number(row.IGDB_ID),
    }),
  );
}

async function deleteGameReleases(gameId: number): Promise<number> {
  const result = await oraMutate(
    `DELETE FROM GAMEDB_RELEASES WHERE GAME_ID = :gameId`,
    { gameId },
  );
  return Number(result.rowsAffected ?? 0);
}

async function clearInitialReleaseDate(gameId: number): Promise<void> {
  await oraMutate(
    `UPDATE GAMEDB_GAMES SET INITIAL_RELEASE_DATE = NULL WHERE GAME_ID = :gameId`,
    { gameId },
  );
}

async function reimportReleaseDates(
  games: IGameWithIgdb[],
  mode: ScriptMode,
): Promise<void> {
  let processed = 0;
  let cleared = 0;
  let imported = 0;
  let failed = 0;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Mode: ${mode.toUpperCase()}`);
  console.log(`Total games with IGDB IDs: ${games.length}`);
  console.log(`${"=".repeat(60)}\n`);

  for (const game of games) {
    processed++;
    const progress = `[${processed}/${games.length}]`;

    try {
      if (mode === "write") {
        const deletedCount = await deleteGameReleases(game.gameId);
        if (deletedCount > 0) {
          cleared++;
          console.log(
            `${progress} Cleared ${deletedCount} release(s) for "${game.title}" (ID: ${game.gameId})`,
          );
        }

        await clearInitialReleaseDate(game.gameId);

        await Game.importReleaseDatesFromIgdb(game.gameId, game.igdbId);
        imported++;
        console.log(
          `${progress} Imported release dates for "${game.title}" (ID: ${game.gameId})`,
        );
      } else {
        const releases = await Game.getGameReleases(game.gameId);
        console.log(
          `${progress} [DRY RUN] Would clear ${releases.length} release(s)` +
          ` and reimport for "${game.title}" (ID: ${game.gameId})`,
        );
      }

      if (processed % 10 === 0) {
        await sleep(500);
      } else {
        await sleep(100);
      }
    } catch (err: any) {
      failed++;
      console.error(
        `${progress} Failed to process "${game.title}" (ID: ${game.gameId}): ${err?.message ?? err}`,
      );
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Summary:`);
  console.log(`  Total processed: ${processed}`);
  if (mode === "write") {
    console.log(`  Games cleared: ${cleared}`);
    console.log(`  Games imported: ${imported}`);
    console.log(`  Failed: ${failed}`);
  } else {
    console.log(`  (Dry run - no changes made)`);
  }
  console.log(`${"=".repeat(60)}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modeArg = args[0]?.toLowerCase();
  const mode: ScriptMode = modeArg === "write" ? "write" : "dry-run";

  if (mode === "dry-run") {
    console.log("\n  Running in DRY-RUN mode. No changes will be made.");
    console.log("   Use 'npm run script:reimport-releases write' to execute.\n");
  } else {
    console.log("\n  Running in WRITE mode. This will modify the database!");
    console.log("   Press Ctrl+C within 5 seconds to cancel...\n");
    await sleep(5000);
  }

  await initOraclePool();

  try {
    const games = await getGamesWithIgdbIds();
    if (!games.length) {
      console.log("No games with IGDB IDs found.");
      return;
    }

    await reimportReleaseDates(games, mode);
  } catch (err: any) {
    console.error("Fatal error:", err?.message ?? err);
    process.exit(1);
  } finally {
    await getOraclePool().close();
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
