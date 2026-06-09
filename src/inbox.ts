import type { GlintCapture, InboxEntryStatus } from "./types";
import { MAX_PROCESSING_RETRIES } from "./constants";
import { firstHttpUrl } from "./url";
import { createId, formatError } from "./utils";

export function normalizeCapture(capture: GlintCapture, fallbackTitle = "Untitled"): GlintCapture {
  const inferredURL = capture.originalURL?.trim() || capture.url?.trim() || firstHttpUrl(capture.text) || firstHttpUrl(capture.note);
  const title = capture.title?.trim() || inferredURL || fallbackTitle;
  return {
    ...capture,
    id: capture.id?.trim() || capture.contentHash?.trim() || createId(),
    title,
    originalURL: inferredURL || undefined,
    createdAt: capture.createdAt?.trim() || new Date().toISOString(),
    attachments: capture.attachments ?? []
  };
}

export function markCaptureProcessed(capture: GlintCapture, notePath: string): GlintCapture {
  const { processingError, processingErrorAt, ...rest } = capture;
  void processingError;
  void processingErrorAt;
  return {
    ...rest,
    processed: true,
    processedAt: new Date().toISOString(),
    processedNotePath: notePath
  };
}

export function markCaptureError(capture: GlintCapture, error: unknown): GlintCapture {
  return {
    ...capture,
    processed: false,
    processingError: formatError(error),
    processingErrorAt: new Date().toISOString(),
    retryCount: (capture.retryCount ?? 0) + 1
  };
}

export function resetCaptureForReprocess(capture: GlintCapture): GlintCapture {
  const { processed, processedAt, processingError, processingErrorAt, ...rest } = capture;
  void processed;
  void processedAt;
  void processingError;
  void processingErrorAt;
  return rest;
}

export function inboxEntryFromRaw(name: string, filePath: string, raw: string, modifiedAt?: number): InboxEntryStatus {
  try {
    const capture = JSON.parse(raw) as GlintCapture;
    return {
      name,
      path: filePath,
      title: capture.title?.trim() || capture.originalURL?.trim() || capture.url?.trim() || undefined,
      createdAt: capture.createdAt,
      modifiedAt,
      processed: capture.processed === true,
      processedAt: capture.processedAt,
      processedNotePath: capture.processedNotePath,
      error: capture.processingError,
      retryCount: capture.retryCount,
      retryLimitReached: (capture.retryCount ?? 0) >= MAX_PROCESSING_RETRIES,
      urlFetchWarning: capture.urlFetchWarning,
      urlFetchStatus: capture.urlFetchStatus
    };
  } catch (error) {
    return {
      name,
      path: filePath,
      modifiedAt,
      processed: false,
      error: formatError(error)
    };
  }
}

export function sortInboxEntries(files: InboxEntryStatus[]): InboxEntryStatus[] {
  return [...files].sort((left, right) => {
    const statusDiff = inboxEntryRank(left) - inboxEntryRank(right);
    if (statusDiff !== 0) return statusDiff;
    const modifiedDiff = (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0);
    if (modifiedDiff !== 0) return modifiedDiff;
    return left.name.localeCompare(right.name);
  });
}

export function isCaptureFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".json") && lower.includes("glintcapture");
}

function inboxEntryRank(file: InboxEntryStatus): number {
  if (file.error) return 0;
  if (!file.processed) return 1;
  return 2;
}
