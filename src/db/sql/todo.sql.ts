import type { SqlEntry } from "./types.js";

const TODO_COLS = `TODO_ID,
              TITLE,
              DETAILS,
              TODO_CATEGORY,
              TODO_SIZE,
              CREATED_BY,
              CREATED_AT,
              UPDATED_AT,
              COMPLETED_AT,
              COMPLETED_BY,
              IS_COMPLETED`;

export const TodoSql = {
  getById: {
    oracle: `SELECT ${TODO_COLS}
       FROM RPG_CLUB_TODOS
      WHERE TODO_ID = :id`,
    postgres: ``,
  } satisfies SqlEntry,

  create: {
    oracle: `INSERT INTO RPG_CLUB_TODOS (TITLE, DETAILS, TODO_CATEGORY, TODO_SIZE, CREATED_BY)
     VALUES (:title, :details, :todoCategory, :todoSize, :createdBy)
     RETURNING TODO_ID INTO :id`,
    postgres: ``,
  } satisfies SqlEntry,

  list: (whereClause: string) =>
    ({
      oracle: `SELECT ${TODO_COLS}
       FROM RPG_CLUB_TODOS
       ${whereClause}
      ORDER BY IS_COMPLETED ASC, CREATED_AT ASC
      FETCH FIRST :limit ROWS ONLY`,
      postgres: ``,
    }) satisfies SqlEntry,

  update: {
    oracle: `UPDATE RPG_CLUB_TODOS
        SET TITLE = CASE WHEN :titleProvided = 1 THEN :title ELSE TITLE END,
            DETAILS = CASE WHEN :detailsProvided = 1 THEN :details ELSE DETAILS END,
            TODO_CATEGORY = CASE
              WHEN :categoryProvided = 1 THEN :todoCategory
              ELSE TODO_CATEGORY
            END,
            TODO_SIZE = CASE
              WHEN :sizeProvided = 1 THEN :todoSize
              ELSE TODO_SIZE
            END
      WHERE TODO_ID = :id`,
    postgres: ``,
  } satisfies SqlEntry,

  delete: {
    oracle: `DELETE FROM RPG_CLUB_TODOS WHERE TODO_ID = :id`,
    postgres: ``,
  } satisfies SqlEntry,

  complete: {
    oracle: `UPDATE RPG_CLUB_TODOS
        SET IS_COMPLETED = 1,
            COMPLETED_AT = SYSTIMESTAMP,
            COMPLETED_BY = :completedBy
      WHERE TODO_ID = :id
        AND IS_COMPLETED = 0`,
    postgres: ``,
  } satisfies SqlEntry,

  countTodos: {
    oracle: `SELECT SUM(CASE WHEN IS_COMPLETED = 1 THEN 0 ELSE 1 END) AS OPEN_COUNT,
            SUM(CASE WHEN IS_COMPLETED = 1 THEN 1 ELSE 0 END) AS COMPLETED_COUNT
       FROM RPG_CLUB_TODOS`,
    postgres: ``,
  } satisfies SqlEntry,

  countTodoSummary: {
    oracle: `SELECT SUM(CASE WHEN IS_COMPLETED = 1 THEN 0 ELSE 1 END) AS OPEN_COUNT,
            SUM(CASE WHEN IS_COMPLETED = 1 THEN 1 ELSE 0 END) AS COMPLETED_COUNT,
            SUM(
              CASE
                WHEN IS_COMPLETED = 0 AND TODO_CATEGORY = 'New Features' THEN 1
                ELSE 0
              END
            ) AS OPEN_NEW_FEATURES,
            SUM(
              CASE
                WHEN IS_COMPLETED = 0 AND TODO_CATEGORY = 'Improvements' THEN 1
                ELSE 0
              END
            ) AS OPEN_IMPROVEMENTS,
            SUM(
              CASE
                WHEN IS_COMPLETED = 0 AND TODO_CATEGORY = 'Defects' THEN 1
                ELSE 0
              END
            ) AS OPEN_DEFECTS,
            SUM(
              CASE
                WHEN IS_COMPLETED = 0 AND TODO_CATEGORY = 'Blocked' THEN 1
                ELSE 0
              END
            ) AS OPEN_BLOCKED,
            SUM(
              CASE
                WHEN IS_COMPLETED = 0 AND TODO_CATEGORY = 'Refactoring' THEN 1
                ELSE 0
              END
            ) AS OPEN_REFACTORING
       FROM RPG_CLUB_TODOS`,
    postgres: ``,
  } satisfies SqlEntry,
};
