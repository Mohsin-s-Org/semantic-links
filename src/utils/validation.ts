export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readBoolean(
  record: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

export function readClampedNumber(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, value));
}

export function readStringList(
  record: Record<string, unknown>,
  key: string,
  fallback: readonly string[]
): string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return [...new Set(normalized)];
}

export function readEnum<const T extends readonly string[]>(
  record: Record<string, unknown>,
  key: string,
  allowed: T,
  fallback: T[number]
): T[number] {
  const value = record[key];
  const matched = typeof value === "string"
    ? allowed.find((candidate) => candidate === value)
    : undefined;
  return matched ?? fallback;
}

export function normalizeDelimitedList(value: string): string[] {
  const entries = value
    .split(/[\n,]/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return [...new Set(entries)];
}
