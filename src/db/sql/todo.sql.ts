import type { ISqlEntry } from "./types.js";

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

const TODO_COLS_PG = `todo_id,
              title,
              details,
              todo_category,
              todo_size,
              created_by,
              created_at,
              updated_at,
              completed_at,
              completed_by,
              is_completed`;

export const TodoSql = {
  getById: {
    oracle: `SELECT ${TODO_COLS}
       FROM RPG_CLUB_TODOS
      WHERE TODO_ID = :id`,
    postgres: `SELECT ${TODO_COLS_PG}
       FROM rpg_club_todos
      WHERE todo_id = :id`,
  } satisfies ISqlEntry,

  create: {
    oracle: `INSERT INTO RPG_CLUB_TODOS (TITLE, DETAILS, TODO_CATEGORY, TODO_SIZE, CREATED_BY)
     VALUES (:title, :details, :todoCategory, :todoSize, :createdBy)
     RETURNING TODO_ID INTO :id`,
    postgres: `INSERT INTO rpg_club_todos (title, details, todo_category, todo_size, created_by)
     VALUES (:title, :details, :todoCategory, :todoSize, :createdBy)
     RETURNING todo_id`,
  } satisfies ISqlEntry,

  list: (whereClause: string) =>
    ({
      oracle: `SELECT ${TODO_COLS}
       FROM RPG_CLUB_TODOS
       ${whereClause}
      ORDER BY IS_COMPLETED ASC, CREATED_AT ASC
      FETCH FIRST :limit ROWS ONLY`,
      postgres: `SELECT ${TODO_COLS_PG}
       FROM rpg_club_todos
       ${whereClause}
      ORDER BY is_completed ASC, created_at ASC
      LIMIT :limit`,
    }) satisfies ISqlEntry,

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
    postgres: `UPDATE rpg_club_todos
        SET title = CASE WHEN :titleProvided = 1 THEN :title ELSE title END,
            details = CASE WHEN :detailsProvided = 1 THEN :details ELSE details END,
            todo_category = CASE
              WHEN :categoryProvided = 1 THEN :todoCategory
              ELSE todo_category
            END,
            todo_size = CASE
              WHEN :sizeProvided = 1 THEN :todoSize
              ELSE todo_size
            END
      WHERE todo_id = :id`,
  } satisfies ISqlEntry,

  delete: {
    oracle: `DELETE FROM RPG_CLUB_TODOS WHERE TODO_ID = :id`,
    postgres: `DELETE FROM rpg_club_todos WHERE todo_id = :id`,
  } satisfies ISqlEntry,

  complete: {
    oracle: `UPDATE RPG_CLUB_TODOS
        SET IS_COMPLETED = 1,
            COMPLETED_AT = SYSTIMESTAMP,
            COMPLETED_BY = :completedBy
      WHERE TODO_ID = :id
        AND IS_COMPLETED = 0`,
    postgres: `UPDATE rpg_club_todos
        SET is_completed = true,
            completed_at = NOW(),
            completed_by = :completedBy
      WHERE todo_id = :id
        AND is_completed = false`,
  } satisfies ISqlEntry,

  countTodos: {
    oracle: `SELECT SUM(CASE WHEN IS_COMPLETED = 1 THEN 0 ELSE 1 END) AS OPEN_COUNT,
            SUM(CASE WHEN IS_COMPLETED = 1 THEN 1 ELSE 0 END) AS COMPLETED_COUNT
       FROM RPG_CLUB_TODOS`,
    postgres: `SELECT SUM(CASE WHEN is_completed THEN 0 ELSE 1 END) AS open_count,
            SUM(CASE WHEN is_completed THEN 1 ELSE 0 END) AS completed_count
       FROM rpg_club_todos`,
  } satisfies ISqlEntry,

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
    postgres: `SELECT SUM(CASE WHEN is_completed THEN 0 ELSE 1 END) AS open_count,
            SUM(CASE WHEN is_completed THEN 1 ELSE 0 END) AS completed_count,
            SUM(
              CASE
                WHEN NOT is_completed AND todo_category = 'New Features' THEN 1
                ELSE 0
              END
            ) AS open_new_features,
            SUM(
              CASE
                WHEN NOT is_completed AND todo_category = 'Improvements' THEN 1
                ELSE 0
              END
            ) AS open_improvements,
            SUM(
              CASE
                WHEN NOT is_completed AND todo_category = 'Defects' THEN 1
                ELSE 0
              END
            ) AS open_defects,
            SUM(
              CASE
                WHEN NOT is_completed AND todo_category = 'Blocked' THEN 1
                ELSE 0
              END
            ) AS open_blocked,
            SUM(
              CASE
                WHEN NOT is_completed AND todo_category = 'Refactoring' THEN 1
                ELSE 0
              END
            ) AS open_refactoring
       FROM rpg_club_todos`,
  } satisfies ISqlEntry,
};
