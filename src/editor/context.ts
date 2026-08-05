import { findTextAnchor, type TextAnchor } from "./anchor.ts";
import { isProtectedAnchor } from "./protected-context.ts";
import { createContextHash } from "./request-key.ts";

export interface SuggestionContext {
  anchor: TextAnchor;
  sentence: string;
  paragraph: string;
  searchText: string;
}

export function extractSuggestionContext(
  documentText: string,
  selectionFrom: number,
  selectionTo: number,
  cursor: number
): SuggestionContext | null {
  const anchor = selectionFrom === selectionTo
    ? findTextAnchor(documentText, cursor)
    : findSelectedAnchor(documentText, selectionFrom, selectionTo);
  if (anchor === null) {
    return null;
  }

  const paragraph = extractParagraph(documentText, anchor.start, anchor.end, 700);
  const sentence = extractSentence(paragraph.text, anchor.start - paragraph.start, anchor.end - paragraph.start);
  const searchText = sentence.length > 0 && sentence !== paragraph.text
    ? `${sentence}\n${paragraph.text}`
    : paragraph.text;
  return {
    anchor: {
      ...anchor,
      context: searchText,
      contextHash: createContextHash(searchText)
    },
    sentence,
    paragraph: paragraph.text,
    searchText
  };
}

function findSelectedAnchor(documentText: string, from: number, to: number): TextAnchor | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > documentText.length || to <= from) {
    return null;
  }
  let start = from;
  let end = to;
  while (start < end && /\s/u.test(documentText.charAt(start))) {
    start += 1;
  }
  while (end > start && /\s/u.test(documentText.charAt(end - 1))) {
    end -= 1;
  }
  if (start === end || end - start > 240 || isProtectedAnchor(documentText, start, end)) {
    return null;
  }
  const text = documentText.slice(start, end);
  if (/\r|\n/u.test(text)) {
    return null;
  }
  return { start, end, text, context: text, contextHash: createContextHash(text) };
}

function extractParagraph(
  documentText: string,
  anchorStart: number,
  anchorEnd: number,
  maximumLength: number
): { start: number; text: string } {
  const before = documentText.slice(0, anchorStart);
  const after = documentText.slice(anchorEnd);
  const previousBoundary = Math.max(before.lastIndexOf("\n\n"), before.lastIndexOf("\r\n\r\n"));
  const nextDoubleLine = after.search(/\r?\n[\t ]*\r?\n/u);
  let start = previousBoundary === -1 ? 0 : previousBoundary + (before.startsWith("\r\n", previousBoundary) ? 4 : 2);
  let end = nextDoubleLine === -1 ? documentText.length : anchorEnd + nextDoubleLine;

  if (end - start > maximumLength) {
    const half = Math.floor(maximumLength / 2);
    start = Math.max(start, anchorStart - half);
    end = Math.min(end, start + maximumLength);
    if (end < anchorEnd) {
      end = anchorEnd;
      start = Math.max(0, end - maximumLength);
    }
  }
  const raw = documentText.slice(start, end);
  const leadingWhitespace = raw.match(/^\s*/u)?.[0].length ?? 0;
  const text = raw.trim();
  return { start: start + leadingWhitespace, text };
}

function extractSentence(paragraph: string, anchorStart: number, anchorEnd: number): string {
  const boundaries = /[.!?؟。！]\s+|\r?\n/gu;
  let start = 0;
  let end = paragraph.length;
  for (const match of paragraph.matchAll(boundaries)) {
    const boundaryStart = match.index;
    const boundaryEnd = boundaryStart + match[0].length;
    if (boundaryEnd <= anchorStart) {
      start = boundaryEnd;
      continue;
    }
    if (boundaryStart >= anchorEnd) {
      end = boundaryStart + 1;
      break;
    }
  }
  return paragraph.slice(start, end).trim();
}
