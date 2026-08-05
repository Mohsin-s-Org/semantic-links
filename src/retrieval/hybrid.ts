import type { LexicalSuggestion } from "../lexical/types.ts";
import type { SemanticMatch } from "./semantic-types.ts";

export function mergeHybridSuggestions(
  lexical: readonly LexicalSuggestion[],
  semantic: readonly SemanticMatch[],
  limit: number
): LexicalSuggestion[] {
  const merged = new Map<string, LexicalSuggestion>();

  for (const suggestion of lexical) {
    merged.set(keyOf(suggestion), { ...suggestion, score: suggestion.score * 0.75 });
  }

  semantic.forEach((match, index) => {
    const rankScore = semantic.length <= 1
      ? 1
      : 1 - index / (semantic.length - 1);
    const key = keyOf(match);
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, {
        targetPath: match.targetPath,
        targetTitle: match.targetTitle,
        targetHeading: match.targetHeading,
        score: 0.7 * rankScore,
        matchKinds: ["semantic"],
        preview: match.preview
      });
      return;
    }
    merged.set(key, {
      ...existing,
      score: Math.min(1, existing.score + 0.55 * rankScore),
      matchKinds: existing.matchKinds.includes("semantic")
        ? existing.matchKinds
        : [...existing.matchKinds, "semantic"],
      preview: match.preview || existing.preview
    });
  });

  return [...merged.values()]
    .sort((left, right) => right.score - left.score
      || left.targetTitle.localeCompare(right.targetTitle))
    .slice(0, Math.max(0, limit));
}

function keyOf(value: { targetPath: string; targetHeading: string | null }): string {
  return `${value.targetPath}\u0000${value.targetHeading ?? ""}`;
}
