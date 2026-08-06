export interface SemanticMatch {
  targetPath: string;
  targetTitle: string;
  targetHeading: string | null;
  similarity: number;
  preview: string;
}
