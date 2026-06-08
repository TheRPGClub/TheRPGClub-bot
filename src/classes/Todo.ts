import oracledb from "oracledb";
import { oraQuery, oraMutate } from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { getSql } from "../db/SqlManager.js";
import { TodoSql } from "../db/sql/index.js";

const dialect = getDialect();

export interface ITodoItem {
  todoId: number;
  title: string;
  details: string | null;
  todoCategory: string | null;
  todoSize: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  completedBy: string | null;
  isCompleted: boolean;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapTodoRow(row: {
  TODO_ID: number;
  TITLE: string;
  DETAILS: string | null;
  TODO_CATEGORY: string | null;
  TODO_SIZE: string | null;
  CREATED_BY: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
  COMPLETED_AT: Date | string | null;
  COMPLETED_BY: string | null;
  IS_COMPLETED: number;
}): ITodoItem {
  return {
    todoId: Number(row.TODO_ID),
    title: row.TITLE,
    details: row.DETAILS ?? null,
    todoCategory: row.TODO_CATEGORY ?? null,
    todoSize: row.TODO_SIZE ?? null,
    createdBy: row.CREATED_BY ?? null,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
    completedAt: row.COMPLETED_AT ? toDate(row.COMPLETED_AT) : null,
    completedBy: row.COMPLETED_BY ?? null,
    isCompleted: (row.IS_COMPLETED ?? 0) === 1,
  };
}

export async function fetchTodoById(todoId: number): Promise<ITodoItem | null> {
  const rows = await oraQuery(
    getSql(TodoSql.getById, dialect),
    { id: todoId },
    mapTodoRow,
  );
  return rows[0] ?? null;
}

export async function createTodo(
  title: string,
  details: string | null,
  todoCategory: string | null,
  todoSize: string | null,
  createdBy: string | null,
): Promise<ITodoItem> {
  const result = await oraMutate(
    getSql(TodoSql.create, dialect),
    {
      title,
      details,
      todoCategory,
      todoSize,
      createdBy,
      id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    },
  );
  const id = Number((result.outBinds as any)?.id?.[0] ?? 0);
  if (!id) {
    throw new Error("Failed to create TODO.");
  }
  const todo = await fetchTodoById(id);
  if (!todo) {
    throw new Error("Failed to load TODO after creation.");
  }
  return todo;
}

export async function listTodos(
  includeCompleted: boolean,
  limit: number = 100,
): Promise<ITodoItem[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const whereClause = includeCompleted ? "" : "WHERE IS_COMPLETED = 0";
  return oraQuery(
    TodoSql.list(whereClause)[dialect],
    { limit: safeLimit },
    mapTodoRow,
  );
}

export async function updateTodo(
  todoId: number,
  title: string | null | undefined,
  details: string | null | undefined,
  todoCategory: string | null | undefined,
  todoSize: string | null | undefined,
): Promise<boolean> {
  const titleProvided = title !== undefined ? 1 : 0;
  const detailsProvided = details !== undefined ? 1 : 0;
  const categoryProvided = todoCategory !== undefined ? 1 : 0;
  const sizeProvided = todoSize !== undefined ? 1 : 0;
  const result = await oraMutate(
    getSql(TodoSql.update, dialect),
    {
      id: todoId,
      title,
      details,
      todoCategory,
      todoSize,
      titleProvided,
      detailsProvided,
      categoryProvided,
      sizeProvided,
    },
  );
  return (result.rowsAffected ?? 0) > 0;
}

export async function deleteTodo(todoId: number): Promise<boolean> {
  const result = await oraMutate(
    getSql(TodoSql.delete, dialect),
    { id: todoId },
  );
  return (result.rowsAffected ?? 0) > 0;
}

export async function completeTodo(
  todoId: number,
  completedBy: string | null,
): Promise<boolean> {
  const result = await oraMutate(
    getSql(TodoSql.complete, dialect),
    { id: todoId, completedBy },
  );
  return (result.rowsAffected ?? 0) > 0;
}

export async function countTodos(): Promise<{ open: number; completed: number }> {
  const rows = await oraQuery(
    getSql(TodoSql.countTodos, dialect),
    {},
    (row: { OPEN_COUNT: number | null; COMPLETED_COUNT: number | null }) => ({
      open: Number(row.OPEN_COUNT ?? 0),
      completed: Number(row.COMPLETED_COUNT ?? 0),
    }),
  );
  return rows[0] ?? { open: 0, completed: 0 };
}

export async function countTodoSummary(): Promise<{
  open: number;
  completed: number;
  openByCategory: {
    newFeatures: number;
    improvements: number;
    defects: number;
    blocked: number;
    refactoring: number;
  };
}> {
  const rows = await oraQuery(
    getSql(TodoSql.countTodoSummary, dialect),
    {},
    (row: {
      OPEN_COUNT: number | null;
      COMPLETED_COUNT: number | null;
      OPEN_NEW_FEATURES: number | null;
      OPEN_IMPROVEMENTS: number | null;
      OPEN_DEFECTS: number | null;
      OPEN_BLOCKED: number | null;
      OPEN_REFACTORING: number | null;
    }) => ({
      open: Number(row.OPEN_COUNT ?? 0),
      completed: Number(row.COMPLETED_COUNT ?? 0),
      openByCategory: {
        newFeatures: Number(row.OPEN_NEW_FEATURES ?? 0),
        improvements: Number(row.OPEN_IMPROVEMENTS ?? 0),
        defects: Number(row.OPEN_DEFECTS ?? 0),
        blocked: Number(row.OPEN_BLOCKED ?? 0),
        refactoring: Number(row.OPEN_REFACTORING ?? 0),
      },
    }),
  );
  return rows[0] ?? {
    open: 0,
    completed: 0,
    openByCategory: {
      newFeatures: 0,
      improvements: 0,
      defects: 0,
      blocked: 0,
      refactoring: 0,
    },
  };
}
