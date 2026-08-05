const WORD_PATTERN = /[\p{L}\p{N}]+/gu;
const COMBINING_MARK_PATTERN = /\p{M}+/gu;
const NON_WORD_PATTERN = /[^\p{L}\p{N}]+/gu;
const BACKTICK_FENCE_PATTERN = /^[\t ]{0,3}`{3,}[^\n]*\n[\s\S]*?^[\t ]{0,3}`{3,}[\t ]*$/gmu;
const TILDE_FENCE_PATTERN = /^[\t ]{0,3}~{3,}[^\n]*\n[\s\S]*?^[\t ]{0,3}~{3,}[\t ]*$/gmu;
const UNCLOSED_FENCE_PATTERN = /^[\t ]{0,3}(?:`{3,}|~{3,})[^\n]*(?:\n[\s\S]*)?$/gmu;
const FRONTMATTER_PATTERN = /^---[\t ]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[\t ]*(?:\r?\n|$)/u;
const ENGLISH_STOP_WORDS = new Set([
  "and", "are", "but", "for", "from", "has", "have", "into", "not", "that",
  "the", "their", "then", "there", "these", "they", "this", "through", "was",
  "were", "what", "when", "where", "which", "while", "with", "would", "you", "your"
]);

export function normalizeLexicalText(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(COMBINING_MARK_PATTERN, "")
    .replace(/[ٱأإآ]/gu, "ا")
    .replace(NON_WORD_PATTERN, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export function tokenizeLexicalText(value: string): string[] {
  const normalized = normalizeLexicalText(value);
  return normalized.match(WORD_PATTERN) ?? [];
}

export function meaningfulLexicalTokens(value: string, limit = 24): string[] {
  const unique = new Set<string>();
  for (const token of tokenizeLexicalText(value)) {
    if (token.length < 3 || ENGLISH_STOP_WORDS.has(token)) {
      continue;
    }
    unique.add(token);
    if (unique.size >= limit) {
      break;
    }
  }
  return [...unique];
}

export function lexicalSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeLexicalText(left);
  const normalizedRight = normalizeLexicalText(right);
  if (normalizedLeft === normalizedRight) {
    return normalizedLeft.length === 0 ? 0 : 1;
  }
  if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
    return 0;
  }

  const width = Math.min(normalizedLeft.length, normalizedRight.length) < 5 ? 2 : 3;
  const leftGrams = createNgrams(normalizedLeft, width);
  const rightGrams = createNgrams(normalizedRight, width);
  let intersection = 0;
  const remaining = new Map<string, number>();
  for (const gram of rightGrams) {
    remaining.set(gram, (remaining.get(gram) ?? 0) + 1);
  }
  for (const gram of leftGrams) {
    const count = remaining.get(gram) ?? 0;
    if (count > 0) {
      intersection += 1;
      remaining.set(gram, count - 1);
    }
  }
  return (2 * intersection) / (leftGrams.length + rightGrams.length);
}

export function createLexicalNgrams(value: string): string[] {
  const normalized = normalizeLexicalText(value);
  if (normalized.length === 0) {
    return [];
  }
  return createNgrams(normalized, normalized.length < 5 ? 2 : 3);
}

export function stripMarkdownForLexicalIndex(markdown: string): string {
  return markdown
    .replace(FRONTMATTER_PATTERN, "")
    .replace(BACKTICK_FENCE_PATTERN, " ")
    .replace(TILDE_FENCE_PATTERN, " ")
    .replace(UNCLOSED_FENCE_PATTERN, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/^\s*\$\$[\s\S]*?^\s*\$\$\s*$/gmu, " ")
    .replace(/`+[^\n]*?`+/gu, " ")
    .replace(/(^|[^\\$])\$(?!\$)[^\n$]+\$/gmu, "$1 ")
    .replace(/!\[\[[^\]\n]+\]\]/gu, " ")
    .replace(/\[\[[^\]\n]+\]\]/gu, " ")
    .replace(/!\[[^\]\n]*\]\([^)\n]+\)/gu, " ")
    .replace(/\[([^\]\n]+)\]\([^)\n]+\)/gu, "$1")
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>()]+/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gmu, " ")
    .replace(/[\*_~^=|]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function compactPreview(value: string, maximumLength = 180): string | null {
  const compact = value.replace(/\s+/gu, " ").trim();
  if (compact.length === 0) {
    return null;
  }
  if (compact.length <= maximumLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maximumLength - 1)).trimEnd()}…`;
}

function createNgrams(value: string, width: number): string[] {
  const padded = ` ${value} `;
  if (padded.length <= width) {
    return [padded];
  }
  const grams: string[] = [];
  for (let index = 0; index <= padded.length - width; index += 1) {
    grams.push(padded.slice(index, index + width));
  }
  return grams;
}
