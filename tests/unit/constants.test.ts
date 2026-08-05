import assert from "node:assert/strict";
import test from "node:test";
import {
  DELETE_INDEX_COMMAND_ID,
  PLUGIN_ID,
  REBUILD_INDEX_COMMAND_ID,
  SHOW_INDEX_STATUS_COMMAND_ID,
  SHOW_SUGGESTIONS_COMMAND_ID
} from "../../src/constants.ts";

test("command ids are short local identifiers", () => {
  assert.deepEqual([
    SHOW_SUGGESTIONS_COMMAND_ID,
    SHOW_INDEX_STATUS_COMMAND_ID,
    REBUILD_INDEX_COMMAND_ID,
    DELETE_INDEX_COMMAND_ID
  ], [
    "show-suggestions",
    "show-index-status",
    "rebuild-index",
    "delete-index"
  ]);
  for (const id of [
    SHOW_SUGGESTIONS_COMMAND_ID,
    SHOW_INDEX_STATUS_COMMAND_ID,
    REBUILD_INDEX_COMMAND_ID,
    DELETE_INDEX_COMMAND_ID
  ]) {
    assert.equal(id.includes(PLUGIN_ID), false);
  }
});
