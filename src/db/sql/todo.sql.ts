import type { ISqlEntry } from "./types.js";

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
    postgres: `SELECT ${TODO_COLS_PG}
       FROM rpg_club_todos
      WHERE todo_id = :id`,
  } satisfies ISqlEntry,

  create: {
    postgres: `INSERT INTO rpg_club_todos (title, details, todo_category, todo_size, created_by)
     VALUES (:title, :details, :todoCategory, :todoSize, :createdBy)
     RETURNING todo_id`,
  } satisfies ISqlEntry,

  list: (whereClause: string) =>
    ({
      postgres: `SELECT ${TODO_COLS_PG}
       FROM rpg_club_todos
       ${whereClause}
      ORDER BY is_completed ASC, created_at ASC
      LIMIT :limit`,
    }) satisfies ISqlEntry,

  update: {
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
    postgres: `DELETE FROM rpg_club_todos WHERE todo_id = :id`,
  } satisfies ISqlEntry,

  complete: {
    postgres: `UPDATE rpg_club_todos
        SET is_completed = true,
            completed_at = NOW(),
            completed_by = :completedBy
      WHERE todo_id = :id
        AND is_completed = false`,
  } satisfies ISqlEntry,

  countTodos: {
    postgres: `SELECT SUM(CASE WHEN is_completed THEN 0 ELSE 1 END) AS open_count,
            SUM(CASE WHEN is_completed THEN 1 ELSE 0 END) AS completed_count
       FROM rpg_club_todos`,
  } satisfies ISqlEntry,

  countTodoSummary: {
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
