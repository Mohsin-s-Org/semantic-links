import assert from "node:assert/strict";
import test from "node:test";
import { EditorSuggestionController } from "../../src/editor/controller.ts";
import type { SuggestionRequestKey } from "../../src/editor/request-key.ts";
import { LexicalIndex } from "../../src/lexical/index.ts";

test("a superseded lexical result cannot become visible", async () => {
  const index = new LexicalIndex();
  index.upsert({
    path: "Water.md",
    title: "Water",
    basename: "Water",
    aliases: [],
    headings: [],
    tags: [],
    body: "water"
  });

  const controller = new EditorSuggestionController();
  const firstStarted = deferred<void>();
  const releaseFirst = deferred<void>();
  const secondFinished = deferred<void>();
  let firstAccepted = false;
  let secondAccepted = false;

  const first = requestKey("water", 1);
  const second = requestKey("hydration", 2);
  controller.schedule(first, 0, async (ticket) => {
    firstStarted.resolve();
    await releaseFirst.promise;
    index.search({
      anchorText: first.anchorText,
      contextText: first.anchorText,
      sourcePath: first.filePath,
      limit: 6,
      minimumScore: 0.5
    });
    firstAccepted = controller.acceptResult(ticket, first);
  });

  await firstStarted.promise;
  controller.schedule(second, 0, (ticket) => {
    secondAccepted = controller.acceptResult(ticket, second);
    secondFinished.resolve();
  });
  await secondFinished.promise;
  releaseFirst.resolve();
  await Promise.resolve();

  assert.equal(firstAccepted, false);
  assert.equal(secondAccepted, true);
  controller.dispose();
});

function requestKey(anchorText: string, documentVersion: number): SuggestionRequestKey {
  return {
    filePath: "Source.md",
    documentVersion,
    anchorStart: 0,
    anchorEnd: anchorText.length,
    anchorText,
    contextHash: `context-${documentVersion}`,
    mode: "automatic"
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      resolvePromise?.(value);
    }
  };
}
