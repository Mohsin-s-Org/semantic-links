import assert from "node:assert/strict";
import test from "node:test";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { App, TFile } from "obsidian";
import {
  PLUGIN_LINK_INSERTION,
  insertVerifiedWikilink,
  type TransactionEditor
} from "../../src/editor/insertion.ts";

class RecordingEditor implements TransactionEditor {
  state: EditorState;
  dispatchCount = 0;
  pluginAnnotations: boolean[] = [];
  private readonly undoStack: string[] = [];
  private readonly redoStack: string[] = [];

  constructor(documentText: string) {
    this.state = EditorState.create({ doc: documentText });
  }

  dispatch(spec: TransactionSpec): void {
    const previous = this.state.doc.toString();
    const transaction = this.state.update(spec);
    this.undoStack.push(previous);
    this.redoStack.length = 0;
    this.state = transaction.state;
    this.dispatchCount += 1;
    this.pluginAnnotations.push(
      transaction.annotation(PLUGIN_LINK_INSERTION) === true
    );
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (previous === undefined) {
      return;
    }

    this.redoStack.push(this.state.doc.toString());
    this.state = EditorState.create({ doc: previous });
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) {
      return;
    }

    this.undoStack.push(this.state.doc.toString());
    this.state = EditorState.create({ doc: next });
  }
}

function createFile(path: string): TFile {
  const name = path.split("/").at(-1) ?? path;
  return {
    path,
    name,
    basename: name.replace(/\.md$/u, ""),
    extension: "md"
  } as unknown as TFile;
}

function createApp(target: TFile | null, shortestPath = "Transpiration"): App {
  return {
    metadataCache: {
      getFirstLinkpathDest: () => target,
      fileToLinktext: () => shortestPath
    }
  } as unknown as App;
}

test("accepting a suggestion performs one annotated transaction", () => {
  const target = createFile("Biology/Transpiration.md");
  const editor = new RecordingEditor("Plants lose water through leaves.");
  const feedback: string[] = [];

  const result = insertVerifiedWikilink(
    createApp(target),
    editor,
    {
      sourcePath: "Biology/Plants.md",
      anchorStart: 12,
      anchorEnd: 17,
      expectedText: "water",
      targetPath: target.path,
      targetHeading: null,
      displayText: "water",
      pathMode: "shortest"
    },
    (message) => feedback.push(message)
  );

  assert.equal(result.ok, true);
  assert.equal(editor.dispatchCount, 1);
  assert.deepEqual(editor.pluginAnnotations, [true]);
  assert.equal(
    editor.state.doc.toString(),
    "Plants lose [[Transpiration|water]] through leaves."
  );
  assert.deepEqual(feedback, ["Linked to Transpiration."]);

  editor.undo();
  assert.equal(editor.state.doc.toString(), "Plants lose water through leaves.");
  editor.redo();
  assert.equal(
    editor.state.doc.toString(),
    "Plants lose [[Transpiration|water]] through leaves."
  );
  assert.equal(editor.dispatchCount, 1);
});

test("changed anchors fail without mutating the document", () => {
  const target = createFile("Biology/Transpiration.md");
  const editor = new RecordingEditor("Plants lose moisture.");
  let feedbackCalls = 0;

  const result = insertVerifiedWikilink(
    createApp(target),
    editor,
    {
      sourcePath: "Biology/Plants.md",
      anchorStart: 12,
      anchorEnd: 17,
      expectedText: "water",
      targetPath: target.path,
      targetHeading: null,
      displayText: "water",
      pathMode: "shortest"
    },
    () => {
      feedbackCalls += 1;
    }
  );

  assert.deepEqual(result, { ok: false, code: "changed-anchor" });
  assert.equal(editor.dispatchCount, 0);
  assert.equal(feedbackCalls, 0);
  assert.equal(editor.state.doc.toString(), "Plants lose moisture.");
});

test("anchors inside an existing wikilink are rejected", () => {
  const target = createFile("Biology/Transpiration.md");
  const editor = new RecordingEditor("Plants lose [[Transpiration|water]].");

  const result = insertVerifiedWikilink(
    createApp(target),
    editor,
    {
      sourcePath: "Biology/Plants.md",
      anchorStart: 28,
      anchorEnd: 33,
      expectedText: "water",
      targetPath: target.path,
      targetHeading: null,
      displayText: "water",
      pathMode: "shortest"
    }
  );

  assert.deepEqual(result, { ok: false, code: "already-linked" });
  assert.equal(editor.dispatchCount, 0);
});

test("missing targets fail before dispatch", () => {
  const editor = new RecordingEditor("Plants lose water.");
  const result = insertVerifiedWikilink(
    createApp(null),
    editor,
    {
      sourcePath: "Biology/Plants.md",
      anchorStart: 12,
      anchorEnd: 17,
      expectedText: "water",
      targetPath: "Missing.md",
      targetHeading: null,
      displayText: null,
      pathMode: "shortest"
    }
  );

  assert.deepEqual(result, { ok: false, code: "target-not-found" });
  assert.equal(editor.dispatchCount, 0);
});

test("full-path mode and headings are applied in the same transaction", () => {
  const target = createFile("Reference/Water Cycle.md");
  const editor = new RecordingEditor("Read evaporation now.");

  const result = insertVerifiedWikilink(
    createApp(target),
    editor,
    {
      sourcePath: "Notes/Today.md",
      anchorStart: 5,
      anchorEnd: 16,
      expectedText: "evaporation",
      targetPath: target.path,
      targetHeading: "#Evaporation",
      displayText: "evaporation",
      pathMode: "full"
    }
  );

  assert.equal(result.ok, true);
  assert.equal(
    editor.state.doc.toString(),
    "Read [[Reference/Water Cycle#Evaporation|evaporation]] now."
  );
  assert.equal(editor.dispatchCount, 1);
});
