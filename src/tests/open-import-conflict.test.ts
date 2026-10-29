import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { isOpenImportConflict } from "../utilities/ApiErrorUtils.js";

function axiosError(status: number, data: unknown): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response = { status, statusText: "", headers: {}, config, data };
  return new AxiosError("failed", "ERR_BAD_REQUEST", config, null, response);
}

test("isOpenImportConflict is true for the open-import 422", () => {
  const body = { error: "user already has an active or paused import" };
  assert.equal(isOpenImportConflict(axiosError(422, body)), true);
});

test("isOpenImportConflict is false for a different 422", () => {
  assert.equal(isOpenImportConflict(axiosError(422, { error: "items is invalid" })), false);
});

test("isOpenImportConflict is false for other statuses and non-API errors", () => {
  const body = { error: "user already has an active or paused import" };
  assert.equal(isOpenImportConflict(axiosError(500, body)), false);
  assert.equal(isOpenImportConflict(new Error("422")), false);
  assert.equal(isOpenImportConflict(null), false);
});
