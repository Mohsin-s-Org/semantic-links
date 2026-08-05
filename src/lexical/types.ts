export type LexicalMatchKind = "title" | "alias" | "heading" | "tag" | "body" | "semantic";

export interface LexicalHeadingInput {
  text: string;
  level: number;
}

export interface LexicalDocumentInput {
  path: string;
  title: string;
  basename: string;
  aliases: readonly string[];
  headings: readonly LexicalHeadingInput[];
  tags: readonly string[];
  body: string;
}

export interface LexicalSearchQuery {
  anchorText: string;
  contextText: string;
  sourcePath: string;
  limit: number;
  minimumScore: number;
}

export interface LexicalSuggestion {
  targetPath: string;
  targetTitle: string;
  targetHeading: string | null;
  score: number;
  matchKinds: readonly LexicalMatchKind[];
  preview: string | null;
}
