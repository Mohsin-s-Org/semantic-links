import {
  Annotation,
  Transaction,
  type EditorState,
  type TransactionSpec
} from "@codemirror/state";
import type { App } from "obsidian";
import type { LinkPathMode } from "../settings/types.ts";

export const PLUGIN_LINK_INSERTION = Annotation.define<boolean>();

export interface TransactionEditor {
  readonly state: EditorState;
  dispatch(spec: TransactionSpec): void;
}

export interface InsertWikilinkRequest {
  sourcePath: string;
  anchorStart: number;
  anchorEnd: number;
  expectedText: string;
  targetPath: string;
  targetHeading: string | null;
  displayText: string | null;
  pathMode: LinkPathMode;
}

export type InsertWikilinkFailureCode =
  | "invalid-range"
  | "changed-anchor"
  | "target-not-found"
  | "invalid-target"
  | "dispatch-failed";

export type InsertWikilinkResult =
  | {
      ok: true;
      insertedText: string;
      targetPath: string;
    }
  | {
      ok: false;
      code: InsertWikilinkFailureCode;
    };

export function insertVerifiedWikilink(
  app: App,
  editor: TransactionEditor,
  request: InsertWikilinkRequest,
  onSuccess: (message: string) => void = () => undefined
): InsertWikilinkResult {
  const documentLength = editor.state.doc.length;
  if (
    !Number.isInteger(request.anchorStart)
    || !Number.isInteger(request.anchorEnd)
    || request.anchorStart < 0
    || request.anchorEnd <= request.anchorStart
    || request.anchorEnd > documentLength
  ) {
    return { ok: false, code: "invalid-range" };
  }

  const currentText = editor.state.doc.sliceString(
    request.anchorStart,
    request.anchorEnd
  );
  if (currentText !== request.expectedText) {
    return { ok: false, code: "changed-anchor" };
  }

  const target = app.metadataCache.getFirstLinkpathDest(
    request.targetPath,
    request.sourcePath
  );
  if (target === null || target.extension.toLowerCase() !== "md") {
    return { ok: false, code: "target-not-found" };
  }

  const linkText = request.pathMode === "full"
    ? target.path.replace(/\.md$/iu, "")
    : app.metadataCache.fileToLinktext(target, request.sourcePath, true);
  if (linkText.trim().length === 0) {
    return { ok: false, code: "invalid-target" };
  }

  const heading = normalizeHeading(request.targetHeading);
  const destination = heading === null ? linkText : `${linkText}#${heading}`;
  const alias = (request.displayText ?? request.expectedText).trim();
  const includeAlias = alias.length > 0
    && alias !== destination
    && !(heading === null && alias === target.basename);
  const insertedText = includeAlias
    ? `[[${destination}|${escapeAlias(alias)}]]`
    : `[[${destination}]]`;

  try {
    editor.dispatch({
      changes: {
        from: request.anchorStart,
        to: request.anchorEnd,
        insert: insertedText
      },
      selection: {
        anchor: request.anchorStart + insertedText.length
      },
      annotations: [
        PLUGIN_LINK_INSERTION.of(true),
        Transaction.userEvent.of("input.semantic-links")
      ]
    });
  } catch {
    return { ok: false, code: "dispatch-failed" };
  }

  onSuccess(`Linked to ${target.basename}.`);
  return {
    ok: true,
    insertedText,
    targetPath: target.path
  };
}

function normalizeHeading(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim().replace(/^#+/u, "").trim();
  return normalized.length > 0 ? normalized : null;
}

function escapeAlias(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("]", "\\]");
}
