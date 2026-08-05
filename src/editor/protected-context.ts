interface TextRange {
  start: number;
  end: number;
}

const WIKILINK_PATTERN = /\[\[[^\]\n]*\]\]/gu;
const INLINE_PATTERNS = [
  WIKILINK_PATTERN,
  /\[[^\]\n]+\]\([^)\n]+\)/gu,
  /\b(?:https?:\/\/|www\.)[^\s<>()]+/giu,
  /(`+)(?!`)[^\n]*?\1/gu,
  /<\/?[A-Za-z][^>]*>/gu
] as const;
const INLINE_MATH_PATTERN = /(^|[^\\$])(\$(?!\$)[^\n$]+\$)/gmu;
const BLOCK_TOKEN_PATTERN = /<!--|-->|\$\$|<\/?[A-Za-z][\w-]*(?:\s[^>]*)?>/gu;
const VOID_HTML_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

export function isInsideWikilink(
  documentText: string,
  start: number,
  end: number
): boolean {
  const line = getLine(documentText, start);
  return rangesFromPattern(line.text, WIKILINK_PATTERN, line.start)
    .some((range) => overlaps(range, start, end));
}

export function isProtectedAnchor(
  documentText: string,
  start: number,
  end: number
): boolean {
  if (start < 0 || end <= start || end > documentText.length) {
    return true;
  }

  const frontmatter = findFrontmatter(documentText);
  if (frontmatter !== null && overlaps(frontmatter, start, end)) {
    return true;
  }
  if (isInsideBlockSyntax(documentText, start)) {
    return true;
  }

  const line = getLine(documentText, start);
  if (INLINE_PATTERNS.some((pattern) => {
    return rangesFromPattern(line.text, pattern, line.start)
      .some((range) => overlaps(range, start, end));
  })) {
    return true;
  }

  return [...line.text.matchAll(INLINE_MATH_PATTERN)].some((match) => {
    const math = match[2];
    if (math === undefined) {
      return false;
    }
    const rangeStart = line.start + match.index + match[0].length - math.length;
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

function isInsideBlockSyntax(documentText: string, position: number): boolean {
  let fenceCharacter: "`" | "~" | null = null;
  let fenceLength = 0;
  let inComment = false;
  let inMath = false;
  const htmlStack: string[] = [];
  let lineStart = 0;

  while (lineStart <= position) {
    const newline = documentText.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? documentText.length : newline;
    const currentLine = position <= lineEnd;
    const fullLine = documentText.slice(lineStart, lineEnd);
    const visibleLine = documentText.slice(
      lineStart,
      currentLine ? position : lineEnd
    );
    const marker = /^[\t ]{0,3}(`{3,}|~{3,})(.*)$/u.exec(fullLine);
    const run = marker?.[1];

    if (fenceCharacter !== null) {
      if (currentLine) {
        return true;
      }
      if (
        run?.[0] === fenceCharacter
        && run.length >= fenceLength
        && (marker?.[2] ?? "").trim().length === 0
      ) {
        fenceCharacter = null;
        fenceLength = 0;
      }
    } else if (run !== undefined) {
      if (currentLine) {
        return true;
      }
      fenceCharacter = run[0] as "`" | "~";
      fenceLength = run.length;
    } else {
      for (const tokenMatch of visibleLine.matchAll(BLOCK_TOKEN_PATTERN)) {
        const token = tokenMatch[0];
        if (token === "<!--") {
          inComment = true;
          continue;
        }
        if (token === "-->") {
          inComment = false;
          continue;
        }
        if (inComment) {
          continue;
        }
        if (token === "$$" && !isEscaped(visibleLine, tokenMatch.index)) {
          inMath = !inMath;
          continue;
        }
        if (!inMath) {
          updateHtmlStack(htmlStack, token);
        }
      }
    }

    if (currentLine) {
      return fenceCharacter !== null
        || inComment
        || inMath
        || htmlStack.length > 0;
    }
    if (newline === -1) {
      break;
    }
    lineStart = newline + 1;
  }

  return false;
}

function updateHtmlStack(stack: string[], token: string): void {
  const closing = /^<\/([A-Za-z][\w-]*)/u.exec(token)?.[1]?.toLocaleLowerCase();
  if (closing !== undefined) {
    const index = stack.lastIndexOf(closing);
    if (index !== -1) {
      stack.splice(index);
    }
    return;
  }

  const opening = /^<([A-Za-z][\w-]*)/u.exec(token)?.[1]?.toLocaleLowerCase();
  if (
    opening !== undefined
    && !VOID_HTML_TAGS.has(opening)
    && !token.endsWith("/>")
  ) {
    stack.push(opening);
  }
}

function getLine(documentText: string, position: number): {
  start: number;
  text: string;
} {
  const start = documentText.lastIndexOf("\n", position - 1) + 1;
  const newline = documentText.indexOf("\n", position);
  const end = newline === -1 ? documentText.length : newline;
  return { start, text: documentText.slice(start, end) };
}

function rangesFromPattern(
  text: string,
  pattern: RegExp,
  offset: number
): TextRange[] {
  return [...text.matchAll(pattern)].map((match) => ({
    start: offset + match.index,
    end: offset + match.index + match[0].length
  }));
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function overlaps(range: TextRange, start: number, end: number): boolean {
  return start < range.end && end > range.start;
}
