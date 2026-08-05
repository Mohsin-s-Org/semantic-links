import assert from "node:assert/strict";
import test from "node:test";
import {
  DELETE_INDEX_COMMAND_ID,
  DOWNLOAD_MODEL_COMMAND_ID,
  PLUGIN_ID,
  REBUILD_INDEX_COMMAND_ID,
  REMOVE_MODEL_COMMAND_ID,
  SHOW_INDEX_STATUS_COMMAND_ID,
  SHOW_SUGGESTIONS_COMMAND_ID
} from "../../src/constants.ts";

const COMMAND_IDS = [
  SHOW_SUGGESTIONS_COMMAND_ID,
  SHOW_INDEX_STATUS_COMMAND_ID,
  REBUILD_INDEX_COMMAND_ID,
  DELETE_INDEX_COMMAND_ID,
  DOWNLOAD_MODEL_COMMAND_ID,
  REMOVE_MODEL_COMMAND_ID
];

test("command ids are short local identifiers", () => {
  assert.deepEqual(COMMAND_IDS, [
    "show-suggestions",
    "show-index-status",
    "rebuild-index",
    "delete-index",
    "download-model",
    "remove-model"
  ]);
  for (const id of COMMAND_IDS) {
    assert.equal(id.includes(PLUGIN_ID), false);
  }
});
