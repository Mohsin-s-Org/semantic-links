interface TextRange {
  start: number;
  end: number;
}

const WIKILINK_PATTERN = /\[\[[^\]\n]*\]\]/gu;
const PROTECTED_PATTERNS = [
  WIKILINK_PATTERN,
  /\[[^\]\n]+\]\([^)\n]+\)/gu,
  /\b(?:https?:\/\/|www\.)[^\s<>()]+/giu,
  /(`+)(?!`)[\s\S]*?\1/gu,
  /\$\$[\s\S]*?\$\$/gu,
  /<!--[\s\S]*?-->/gu,
  /<([A-Za-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,
  /<\/?[A-Za-z][^>]*>/gu
] as const;
const INLINE_MATH_PATTERN = /(^|[^\\$])(\$(?!\$)[^\n$]+\$)/gmu;

export function isInsideWikilink(
  documentText: string,
  start: number,
  end: number
): boolean {
  return rangesFromPattern(documentText, WIKILINK_PATTERN)
    .some((range) => overlaps(range, start, end));
}

export function isProtectedAnchor(
  documentText: string,
  start: number,
  end: number
): boolean {
  const frontmatter = findFrontmatter(documentText);
  if (frontmatter !== null && overlaps(frontmatter, start, end)) {
    return true;
  }
  if (isInsideFence(documentText, start)) {
    return true;
  }
  if (PROTECTED_PATTERNS.some((pattern) => {
    return rangesFromPattern(documentText, pattern)
      .some((range) => overlaps(range, start, end));
  })) {
    return true;
  }

  return [...documentText.matchAll(INLINE_MATH_PATTERN)].some((match) => {
    const math = match[2];
    if (math === undefined) {
      return false;
    }
    const rangeStart = match.index + match[0].length - math.length;
    return overlaps(
      { start: rangeStart, end: rangeStart + math.length },
      start,
      end
    );
  });
}

function findFrontmatter(documentText: string): TextRange | null {
  if (!/^---[\t ]*(?:\r?\n|$)/u.test(documentText)) {
    return null;
  }

  const closing = /^(?:---|\.\.\.)[\t ]*$/gmu;
  closing.lastIndex = documentText.indexOf("\n") + 1;
  const match = closing.exec(documentText);
  return match === null
    ? { start: 0, end: documentText.length }
    : { start: 0, end: match.index + match[0].length };
}

function isInsideFence(documentText: string, position: number): boolean {
  let fenceCharacter: "`" | "~" | null = null;
  let fenceLength = 0;

  for (const match of documentText.matchAll(/[^\n]*(?:\n|$)/gu)) {
    const lineStart = match.index;
    if (lineStart > position) {
      break;
    }

    const line = match[0].replace(/\n$/u, "");
    const marker = /^[\t ]{0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    const run = marker?.[1];
    if (run === undefined) {
      continue;
    }

    if (fenceCharacter === null) {
      fenceCharacter = run[0] as "`" | "~";
      fenceLength = run.length;
      if (position < lineStart + match[0].length) {
        return true;
      }
      continue;
    }

    if (
      run[0] === fenceCharacter
      && run.length >= fenceLength
      && (marker?.[2] ?? "").trim().length === 0
    ) {
      if (position < lineStart + match[0].length) {
        return true;
      }
      fenceCharacter = null;
      fenceLength = 0;
    }
  }

  return fenceCharacter !== null;
}

function rangesFromPattern(documentText: string, pattern: RegExp): TextRange[] {
  return [...documentText.matchAll(pattern)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length
  }));
}

function overlaps(range: TextRange, start: number, end: number): boolean {
  return start < range.end && end > range.start;
}
