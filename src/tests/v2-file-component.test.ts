import assert from "node:assert/strict";
import test from "node:test";
import { buildFileComponent, buildTextContainer } from "../functions/ComponentsV2Utils.js";

test("a file component added to a text container serializes with its attachment", () => {
  const container = buildTextContainer("Download")
    .addFileComponents(buildFileComponent("news-import-unsorted.csv"));

  const json = container.toJSON() as { components: { type: number; file?: { url: string } }[] };

  assert.deepEqual(json.components.at(-1)?.file, { url: "attachment://news-import-unsorted.csv" });
});
