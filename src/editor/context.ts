import { findTextAnchor, type TextAnchor } from "./anchor.ts";
import { isProtectedAnchor } from "./protected-context.ts";
import { createContextHash } from "./request-key.ts";

export interface SuggestionContext {
  anchor: TextAnchor;
  selection: string | null;
  previousSentence: string | null;
  sentence: string;
  nextSentence: string | null;
  paragraph: string;
  searchText: string;
}

interface SentenceRange {
  start: number;
  end: number;
  text: string;
}

export function extractSuggestionContext(
  documentText: string,
  selectionFrom: number,
  selectionTo: number,
  cursor: number
): SuggestionContext | null {
  const hasSelection = selectionFrom !== selectionTo;
  const anchor = hasSelection
    ? findSelectedAnchor(documentText, selectionFrom, selectionTo)
    : findTextAnchor(documentText, cursor);
  if (anchor === null) {
    return null;
  }

  const paragraph = extractParagraph(documentText, anchor.start, anchor.end, 700);
  const sentences = extractSentenceWindow(
    paragraph.text,
    anchor.start - paragraph.start,
    anchor.end - paragraph.start
  );
  const searchText = sentences.active.length > 0 && sentences.active !== paragraph.text
    ? `${sentences.active}\n${paragraph.text}`
    : paragraph.text;
  return {
    anchor: {
      ...anchor,
      context: searchText,
      contextHash: createContextHash(searchText)
    },
    selection: hasSelection ? anchor.text : null,
    previousSentence: sentences.previous,
    sentence: sentences.active,
    nextSentence: sentences.next,
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

function extractSentenceWindow(
  paragraph: string,
  anchorStart: number,
  anchorEnd: number
): { previous: string | null; active: string; next: string | null } {
  const ranges = sentenceRanges(paragraph);
  if (ranges.length === 0) {
    return { previous: null, active: paragraph.trim(), next: null };
  }
  const activeIndex = ranges.findIndex((range) => {
    return range.end >= anchorStart && range.start <= anchorEnd;
  });
  const index = activeIndex === -1
    ? nearestSentenceIndex(ranges, anchorStart)
    : activeIndex;
  return {
    previous: ranges[index - 1]?.text ?? null,
    active: ranges[index]?.text ?? paragraph.trim(),
    next: ranges[index + 1]?.text ?? null
  };
}

function sentenceRanges(paragraph: string): SentenceRange[] {
  const ranges: SentenceRange[] = [];
  const boundaries = /[!?؟。！]+|\.(?=\s|$|\p{Script=Arabic})|\r?\n+/gu;
  let segmentStart = 0;
  for (const match of paragraph.matchAll(boundaries)) {
    const boundaryStart = match.index;
    const boundaryEnd = boundaryStart + match[0].length;
    pushSentenceRange(ranges, paragraph, segmentStart, boundaryEnd);
    segmentStart = boundaryEnd;
  }
  pushSentenceRange(ranges, paragraph, segmentStart, paragraph.length);
  return ranges;
}

function pushSentenceRange(
  ranges: SentenceRange[],
  source: string,
  start: number,
  end: number
): void {
  let trimmedStart = start;
  let trimmedEnd = end;
  while (trimmedStart < trimmedEnd && /\s/u.test(source.charAt(trimmedStart))) {
    trimmedStart += 1;
  }
  while (trimmedEnd > trimmedStart && /\s/u.test(source.charAt(trimmedEnd - 1))) {
    trimmedEnd -= 1;
  }
  if (trimmedStart < trimmedEnd) {
    ranges.push({
      start: trimmedStart,
      end: trimmedEnd,
      text: source.slice(trimmedStart, trimmedEnd)
    });
  }
}

function nearestSentenceIndex(
  ranges: readonly SentenceRange[],
  anchorStart: number
): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  ranges.forEach((range, index) => {
    const distance = anchorStart < range.start
      ? range.start - anchorStart
      : Math.max(0, anchorStart - range.end);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}
