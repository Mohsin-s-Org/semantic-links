import assert from "node:assert/strict";
import test from "node:test";
import {
  canReuseDocument,
  needsDocumentRead
} from "../../src/indexing/change-detection.ts";
import type { IndexedDocument } from "../../src/indexing/types.ts";

const document: IndexedDocument = {
  id: "document-a",
  path: "Notes/A.md",
  title: "A",
  aliases: [],
  tags: [],
  headings: [],
  outgoingPaths: [],
  contentHash: "same-content",
  modifiedAt: 100,
  chunkIds: ["chunk-a"]
};

test("skips an unchanged mtime before reading note content", () => {
  assert.equal(needsDocumentRead(document, 100), false);
  assert.equal(needsDocumentRead(document, 101), true);
  assert.equal(needsDocumentRead(undefined, 100), true);
});

test("reuses existing chunks and vectors when a reread has the same hash", () => {
  assert.equal(canReuseDocument(document, "same-content"), true);
  assert.equal(canReuseDocument(document, "different-content"), false);
});
