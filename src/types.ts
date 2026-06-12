import type { TFile } from "obsidian";

export type ProviderType = "local" | "ollama" | "openai-compatible";
export type AppLanguage = "zh" | "en";
export type DuplicateStrategy = "update-existing" | "skip" | "create-copy";
export type ProcessStep = "reading" | "fetching-url" | "analyzing" | "writing" | "marking-processed";

export interface GlintSettings {
  language: AppLanguage;
  inboxFolder: string;
  outputFolder: string;
  autoProcessInbox: boolean;
  fetchUrlContent: boolean;
  duplicateStrategy: DuplicateStrategy;
  includeSummaryCallout: boolean;
  includeSourceSection: boolean;
  includeOriginalExcerpt: boolean;
  includeUrlMetadata: boolean;
  providerType: ProviderType;
  endpointUrl: string;
  modelName: string;
  apiKey: string;
  temperature: number;
  maxExistingCategories: number;
  maxExistingTags: number;
  lastProviderTestAt?: string;
  lastProviderTestOk?: boolean;
  lastProviderTestError?: string;
}

export interface CaptureAttachment {
  filename: string;
  mimeType?: string;
}

export interface GlintCapture {
  schemaVersion?: number;
  id?: string;
  contentType?: string;
  createdAt?: string;
  captureMethod?: string;
  title?: string;
  originalURL?: string;
  url?: string;
  text?: string;
  note?: string;
  attachments?: CaptureAttachment[];
  contentHash?: string;
  urlTitle?: string;
  urlSiteName?: string;
  urlAuthor?: string;
  urlPublishedAt?: string;
  processed?: boolean;
  processedAt?: string;
  processedNotePath?: string;
  processingWarning?: string;
  processingError?: string;
  processingErrorAt?: string;
  retryCount?: number;
  urlFetchStatus?: "ok" | "failed" | "insufficient";
  urlFetchWarning?: string;
  urlFetchTextLength?: number;
}

export interface TaxonomyContext {
  categories: string[];
  tags: string[];
}

export interface AnalysisResult {
  title: string;
  summary: string;
  keyPoints: string[];
  note?: string;
  tags: string[];
  category: string;
  entities: string[];
  providerName: string;
  modelName?: string;
  fallbackWarning?: string;
}

export interface FetchedURLContent {
  title?: string;
  siteName?: string;
  author?: string;
  publishedAt?: string;
  text: string;
}

export interface ProcessCaptureResult {
  capture: GlintCapture;
  note: TFile;
}

export interface InboxEntryStatus {
  name: string;
  path: string;
  title?: string;
  createdAt?: string;
  modifiedAt?: number;
  processed: boolean;
  processedAt?: string;
  processedNotePath?: string;
  error?: string;
  retryCount?: number;
  retryLimitReached?: boolean;
  warning?: string;
  urlFetchWarning?: string;
  urlFetchStatus?: GlintCapture["urlFetchStatus"];
}

export interface CurrentProcessStatus {
  fileName?: string;
  filePath?: string;
  title?: string;
  step: ProcessStep;
  startedAt: string;
  updatedAt: string;
}

export interface InboxDiagnostics {
  inboxExists: boolean;
  outputExists: boolean;
  lastReceivedAt?: string | number;
  autoProcessRunning: boolean;
  isProcessing: boolean;
  queuedTasks: number;
  currentProcess?: CurrentProcessStatus;
  lastProcessStartedAt?: string;
  lastProcessFinishedAt?: string;
  lastProcessError?: string;
  lastProviderTestAt?: string;
  lastProviderTestOk?: boolean;
  lastProviderTestError?: string;
  urlWarnings: number;
}

export interface InboxStatusSnapshot {
  sourceType: "external" | "vault";
  inboxPath: string;
  outputFolder: string;
  autoProcessInbox: boolean;
  providerLabel: string;
  total: number;
  pending: number;
  processed: number;
  invalid: number;
  files: InboxEntryStatus[];
  diagnostics: InboxDiagnostics;
  refreshedAt: string;
}
