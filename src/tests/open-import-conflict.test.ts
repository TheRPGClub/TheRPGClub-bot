import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { isOpenImportConflict } from "../utilities/ApiErrorUtils.js";

function axiosError(status: number): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response = { status, statusText: "", headers: {}, config, data: {} };
  return new AxiosError("failed", "ERR_BAD_REQUEST", config, null, response);
}

test("isOpenImportConflict is true for an API 422", () => {
  assert.equal(isOpenImportConflict(axiosError(422)), true);
});

test("isOpenImportConflict is false for other statuses and non-API errors", () => {
  assert.equal(isOpenImportConflict(axiosError(500)), false);
  assert.equal(isOpenImportConflict(new Error("422")), false);
  assert.equal(isOpenImportConflict(null), false);
});
