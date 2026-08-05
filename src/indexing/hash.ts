export function hashText(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

export function createDocumentId(path: string): string {
  return `document-${hashText(path.toLocaleLowerCase())}`;
}

export function createChunkId(
  documentId: string,
  headingPath: readonly string[],
  embeddingText: string,
  occurrence: number
): string {
  return `chunk-${hashText(JSON.stringify([
    documentId,
    headingPath,
    embeddingText,
    occurrence
  ]))}`;
}
