export interface MatchingPolicySettings {
  lexicalMatchingEnabled: boolean;
  semanticModelEnabled: boolean;
}

export function hasEnabledMatching(settings: MatchingPolicySettings): boolean {
  return settings.lexicalMatchingEnabled || settings.semanticModelEnabled;
}

export function shouldRunLexicalMatching(settings: MatchingPolicySettings): boolean {
  return settings.lexicalMatchingEnabled;
}
