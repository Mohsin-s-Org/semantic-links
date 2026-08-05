interface TextRange {
  start: number;
  end: number;
}

const INLINE_PATTERNS = [
  /\[\[[^\]\n]*\]\]/gu,
  /\[[^\]\n]+\]\([^)\n]+\)/gu,
  /\b(?:https?:\/\/|www\.)[^\s<>()]+/giu,
  /(`+)(?!`)[\s\S]*?\1/gu,
  /\$\$[\s\S]*?\$\$/gu,
  /(^|[^\\$])\$(?!\$)[^\n$]+\$/gmu,
  /<!--[\s\S]*?-->/gu,
  /<([A-Za-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,
  /<\/?[A-Za-z][^>]*>/gu
] as const;

export function isInsideWikilink(
  documentText: string,
  start: number,
  end: number
): boolean {
  return rangesFromPattern(documentText, INLINE_PATTERNS[0])
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

  return INLINE_PATTERNS.some((pattern, index) => {
    const prefixLength = index === 5 ? 1 : 0;
    return rangesFromPattern(documentText, pattern, prefixLength)
      .some((range) => overlaps(range, start, end));
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
    if (marker === null) {
      continue;
    }

    const run = marker[1];
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
      && (marker[2] ?? "").trim().length === 0
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

function rangesFromPattern(
  documentText: string,
  pattern: RegExp,
  prefixLength = 0
): TextRange[] {
  return [...documentText.matchAll(pattern)].map((match) => ({
    start: match.index + prefixLength,
    end: match.index + match[0].length
  }));
}

function overlaps(range: TextRange, start: number, end: number): boolean {
  return start < range.end && end > range.start;
}
