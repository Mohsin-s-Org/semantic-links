import assert from "node:assert/strict";
import test from "node:test";
import {
  PLUGIN_ID,
  SHOW_SUGGESTIONS_COMMAND_ID
} from "../../src/constants.ts";

test("command ids are short local identifiers", () => {
  assert.equal(SHOW_SUGGESTIONS_COMMAND_ID, "show-suggestions");
  assert.equal(SHOW_SUGGESTIONS_COMMAND_ID.includes(PLUGIN_ID), false);
});
