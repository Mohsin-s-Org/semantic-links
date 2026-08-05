import { createContextHash } from "./request-key.ts";

export interface TextAnchor {
  start: number;
  end: number;
  text: string;
  context: string;
  contextHash: string;
}

const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_-]/u;

export function findTextAnchor(documentText: string, cursor: number): TextAnchor | null {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > documentText.length) {
    return null;
  }

  let start = cursor;
  let end = cursor;

  while (start > 0 && WORD_CHARACTER.test(documentText.charAt(start - 1))) {
    start -= 1;
  }
  while (end < documentText.length && WORD_CHARACTER.test(documentText.charAt(end))) {
    end += 1;
  }

  if (start === end) {
    return null;
  }

  const contextStart = Math.max(0, start - 160);
  const contextEnd = Math.min(documentText.length, end + 160);
  const context = documentText.slice(contextStart, contextEnd);

  return {
    start,
    end,
    text: documentText.slice(start, end),
    context,
    contextHash: createContextHash(context)
  };
}
