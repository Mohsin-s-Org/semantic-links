import {
  compactPreview,
  meaningfulLexicalTokens,
  stripMarkdownForLexicalIndex,
  tokenizeLexicalText
} from "../lexical/text.ts";

export interface ChunkingOptions {
  minimumWords: number;
  targetWords: number;
  maximumWords: number;
}

export interface MarkdownChunk {
  headingPath: string[];
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  text: string;
  textPreview: string;
  lexicalTerms: string[];
  embeddingText: string;
}

interface SourceBlock {
  headingPath: string[];
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  rawText: string;
}

interface SourceLine {
  number: number;
  start: number;
  end: number;
  text: string;
}

const DEFAULT_OPTIONS: Readonly<ChunkingOptions> = Object.freeze({
  minimumWords: 40,
  targetWords: 120,
  maximumWords: 220
});

export function chunkMarkdown(
  markdown: string,
  title: string,
  options: Partial<ChunkingOptions> = {}
): MarkdownChunk[] {
  const resolved = validateOptions({ ...DEFAULT_OPTIONS, ...options });
  const blocks = splitIntoBlocks(markdown)
    .flatMap((block) => splitOversizedBlock(block, resolved.maximumWords, resolved.targetWords));
  const merged = mergeSmallBlocks(blocks, resolved.minimumWords, resolved.targetWords, resolved.maximumWords);

  return merged.flatMap((block) => {
    const text = stripMarkdownForLexicalIndex(block.rawText);
    if (text.length === 0) {
      return [];
    }
    const breadcrumb = block.headingPath.join(" > ");
    const embeddingText = [
      `passage: ${title}`,
      breadcrumb,
      text
    ].filter((part) => part.length > 0).join("\n");
    return [{
      headingPath: block.headingPath,
      startOffset: block.startOffset,
      endOffset: block.endOffset,
      startLine: block.startLine,
      endLine: block.endLine,
      text,
      textPreview: compactPreview(text) ?? text,
      lexicalTerms: meaningfulLexicalTokens(text, 64),
      embeddingText
    }];
  });
}

function splitIntoBlocks(markdown: string): SourceBlock[] {
  const lines = readLines(markdown);
  const headings: string[] = [];
  const blocks: SourceBlock[] = [];
  let buffered: SourceLine[] = [];
  let fence: "code" | "math" | null = null;
  let fenceMarker = "";
  let inFrontmatter = lines[0]?.text.trim() === "---";
  let inComment = false;

  const flush = (): void => {
    if (buffered.length === 0) {
      return;
    }
    const first = buffered[0];
    const last = buffered.at(-1);
    if (first !== undefined && last !== undefined) {
      blocks.push({
        headingPath: [...headings],
        startOffset: first.start,
        endOffset: last.end,
        startLine: first.number,
        endLine: last.number,
        rawText: markdown.slice(first.start, last.end)
      });
    }
    buffered = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    const trimmed = line.text.trim();

    if (inFrontmatter) {
      if (index > 0 && (trimmed === "---" || trimmed === "...")) {
        inFrontmatter = false;
      }
      continue;
    }
    if (inComment) {
      if (line.text.includes("-->")) {
        inComment = false;
      }
      continue;
    }
    if (line.text.includes("<!--")) {
      flush();
      inComment = !line.text.includes("-->", line.text.indexOf("<!--") + 4);
      continue;
    }
    if (fence !== null) {
      if (
        (fence === "math" && /^\s*\$\$\s*$/u.test(line.text))
        || (fence === "code" && new RegExp(`^\\s{0,3}${escapeRegExp(fenceMarker)}\\s*$`, "u").test(line.text))
      ) {
        fence = null;
        fenceMarker = "";
      }
      continue;
    }

    const codeFence = line.text.match(/^\s{0,3}(`{3,}|~{3,})/u);
    if (codeFence !== null) {
      flush();
      fence = "code";
      fenceMarker = codeFence[1] ?? "```";
      continue;
    }
    if (/^\s*\$\$\s*$/u.test(line.text)) {
      flush();
      fence = "math";
      continue;
    }

    const heading = line.text.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (heading !== null) {
      flush();
      const level = heading[1]?.length ?? 1;
      const text = stripMarkdownForLexicalIndex(heading[2] ?? "");
      headings.length = Math.max(0, level - 1);
      if (text.length > 0) {
        headings[level - 1] = text;
      }
      continue;
    }

    if (trimmed.length === 0) {
      flush();
      continue;
    }
    buffered.push(line);
  }
  flush();
  return blocks;
}

function splitOversizedBlock(
  block: SourceBlock,
  maximumWords: number,
  targetWords: number
): SourceBlock[] {
  if (wordCount(block.rawText) <= maximumWords) {
    return [block];
  }

  const sentences = sentenceSegments(block);
  if (sentences.length <= 1) {
    return splitByWords(block, maximumWords);
  }

  const chunks: SourceBlock[] = [];
  let current: SourceBlock[] = [];
  let currentWords = 0;
  for (const sentence of sentences) {
    const sentenceWords = wordCount(sentence.rawText);
    if (sentenceWords > maximumWords) {
      if (current.length > 0) {
        chunks.push(joinBlocks(current));
        current = [];
        currentWords = 0;
      }
      chunks.push(...splitByWords(sentence, maximumWords));
      continue;
    }
    if (current.length > 0 && currentWords + sentenceWords > maximumWords) {
      const previousSentence = current.at(-1);
      chunks.push(joinBlocks(current));
      current = previousSentence === undefined ? [] : [previousSentence];
      currentWords = previousSentence === undefined ? 0 : wordCount(previousSentence.rawText);
    }
    current.push(sentence);
    currentWords += sentenceWords;
    if (currentWords >= targetWords) {
      const overlap = current.at(-1);
      chunks.push(joinBlocks(current));
      current = overlap === undefined ? [] : [overlap];
      currentWords = overlap === undefined ? 0 : wordCount(overlap.rawText);
    }
  }
  if (current.length > 0) {
    const joined = joinBlocks(current);
    const previous = chunks.at(-1);
    if (previous === undefined || joined.startOffset !== previous.startOffset || joined.endOffset !== previous.endOffset) {
      chunks.push(joined);
    }
  }
  return chunks;
}

function mergeSmallBlocks(
  blocks: SourceBlock[],
  minimumWords: number,
  targetWords: number,
  maximumWords: number
): SourceBlock[] {
  const merged: SourceBlock[] = [];
  for (const block of blocks) {
    const previous = merged.at(-1);
    if (
      previous !== undefined
      && arraysEqual(previous.headingPath, block.headingPath)
      && (wordCount(previous.rawText) < minimumWords || wordCount(block.rawText) < minimumWords)
      && wordCount(`${previous.rawText}\n${block.rawText}`) <= maximumWords
    ) {
      merged[merged.length - 1] = joinBlocks([previous, block]);
      continue;
    }
    merged.push(block);
  }

  for (let index = merged.length - 1; index > 0; index -= 1) {
    const block = merged[index];
    const previous = merged[index - 1];
    if (
      block !== undefined
      && previous !== undefined
      && wordCount(block.rawText) < minimumWords
      && arraysEqual(previous.headingPath, block.headingPath)
      && wordCount(`${previous.rawText}\n${block.rawText}`) <= Math.max(targetWords, maximumWords)
    ) {
      merged[index - 1] = joinBlocks([previous, block]);
      merged.splice(index, 1);
    }
  }
  return merged;
}

function sentenceSegments(block: SourceBlock): SourceBlock[] {
  const segments: SourceBlock[] = [];
  const pattern = /[^.!?؟。！\n]+(?:[.!?؟。！]+|\n+|$)/gu;
  for (const match of block.rawText.matchAll(pattern)) {
    const text = match[0];
    if (stripMarkdownForLexicalIndex(text).length === 0) {
      continue;
    }
    const relativeStart = match.index;
    const relativeEnd = relativeStart + text.length;
    const startOffset = block.startOffset + relativeStart;
    const endOffset = block.startOffset + relativeEnd;
    segments.push({
      headingPath: block.headingPath,
      startOffset,
      endOffset,
      startLine: block.startLine + countNewlines(block.rawText.slice(0, relativeStart)),
      endLine: block.startLine + countNewlines(block.rawText.slice(0, relativeEnd)),
      rawText: text
    });
  }
  return segments;
}

function splitByWords(block: SourceBlock, maximumWords: number): SourceBlock[] {
  const matches = [...block.rawText.matchAll(/[\p{L}\p{N}]+/gu)];
  if (matches.length <= maximumWords) {
    return [block];
  }
  const chunks: SourceBlock[] = [];
  for (let start = 0; start < matches.length; start += maximumWords) {
    const first = matches[start];
    const last = matches[Math.min(matches.length - 1, start + maximumWords - 1)];
    if (first === undefined || last === undefined) {
      continue;
    }
    const relativeStart = first.index;
    const relativeEnd = last.index + last[0].length;
    chunks.push({
      headingPath: block.headingPath,
      startOffset: block.startOffset + relativeStart,
      endOffset: block.startOffset + relativeEnd,
      startLine: block.startLine + countNewlines(block.rawText.slice(0, relativeStart)),
      endLine: block.startLine + countNewlines(block.rawText.slice(0, relativeEnd)),
      rawText: block.rawText.slice(relativeStart, relativeEnd)
    });
  }
  return chunks;
}

function joinBlocks(blocks: readonly SourceBlock[]): SourceBlock {
  const first = blocks[0];
  const last = blocks.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("Cannot join an empty block list.");
  }
  return {
    headingPath: first.headingPath,
    startOffset: first.startOffset,
    endOffset: last.endOffset,
    startLine: first.startLine,
    endLine: last.endLine,
    rawText: blocks.map((block) => block.rawText).join("\n")
  };
}

function readLines(markdown: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const pattern = /.*(?:\r\n|\n|$)/gu;
  for (const match of markdown.matchAll(pattern)) {
    if (match[0].length === 0) {
      continue;
    }
    const start = match.index;
    const end = start + match[0].length;
    lines.push({
      number: lines.length + 1,
      start,
      end,
      text: match[0].replace(/\r?\n$/u, "")
    });
  }
  return lines;
}

function validateOptions(options: ChunkingOptions): ChunkingOptions {
  if (
    !Number.isInteger(options.minimumWords)
    || !Number.isInteger(options.targetWords)
    || !Number.isInteger(options.maximumWords)
    || options.minimumWords < 1
    || options.minimumWords > options.targetWords
    || options.targetWords > options.maximumWords
  ) {
    throw new Error("Invalid Markdown chunking limits.");
  }
  return options;
}

function wordCount(value: string): number {
  return tokenizeLexicalText(stripMarkdownForLexicalIndex(value)).length;
}

function countNewlines(value: string): number {
  return value.match(/\n/gu)?.length ?? 0;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
