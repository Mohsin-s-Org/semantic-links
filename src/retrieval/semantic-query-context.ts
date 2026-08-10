import type { SuggestionContext } from "../editor/context.ts";

export type SemanticQueryContextVariant =
  | "legacy-title-sentence-paragraph"
  | "focus-only"
  | "title-focus"
  | "title-focus-neighbours";

export interface SemanticQueryContext {
  variant: SemanticQueryContextVariant;
  text: string;
  focus: string;
  componentCount: number;
}

export function buildSemanticQueryContext(
  noteTitle: string,
  context: SuggestionContext,
  variant: SemanticQueryContextVariant = "title-focus-neighbours"
): SemanticQueryContext {
  const title = canonicalizeSemanticWhitespace(noteTitle);
  const focus = canonicalizeSemanticWhitespace(
    context.selection ?? context.sentence ?? context.anchor.text
  );
  const previous = canonicalizeOptional(context.previousSentence);
  const next = canonicalizeOptional(context.nextSentence);
  const sentence = canonicalizeSemanticWhitespace(context.sentence);
  const paragraph = canonicalizeSemanticWhitespace(context.paragraph);

  const components = variantComponents(
    variant,
    title,
    focus,
    previous,
    next,
    sentence,
    paragraph
  );
  return {
    variant,
    text: components.map(([label, value]) => `${label}: ${value}`).join("\n"),
    focus,
    componentCount: components.length
  };
}

export function canonicalizeSemanticWhitespace(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function variantComponents(
  variant: SemanticQueryContextVariant,
  title: string,
  focus: string,
  previous: string | null,
  next: string | null,
  sentence: string,
  paragraph: string
): Array<readonly [string, string]> {
  switch (variant) {
    case "legacy-title-sentence-paragraph":
      return compactComponents([
        ["Note", title],
        ["Sentence", sentence],
        ["Paragraph", paragraph]
      ]);
    case "focus-only":
      return compactComponents([["Focus", focus]]);
    case "title-focus":
      return compactComponents([
        ["Note", title],
        ["Focus", focus]
      ]);
    case "title-focus-neighbours":
      return compactComponents([
        ["Note", title],
        ["Previous", previous],
        ["Focus", focus],
        ["Next", next]
      ]);
  }
}

function compactComponents(
  components: ReadonlyArray<readonly [string, string | null]>
): Array<readonly [string, string]> {
  return components.flatMap(([label, value]) => {
    return value === null || value.length === 0 ? [] : [[label, value] as const];
  });
}

function canonicalizeOptional(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const canonical = canonicalizeSemanticWhitespace(value);
  return canonical.length === 0 ? null : canonical;
}
