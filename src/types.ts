import type { TFile } from "obsidian";

export type ProviderType = "local" | "ollama" | "openai-compatible";
export type AppLanguage = "zh" | "en";

export interface GlintSettings {
  language: AppLanguage;
  inboxFolder: string;
  outputFolder: string;
  autoProcessInbox: boolean;
  fetchUrlContent: boolean;
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
  processed?: boolean;
  processedAt?: string;
  processedNotePath?: string;
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
}

export interface FetchedURLContent {
  title?: string;
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
  urlFetchWarning?: string;
  urlFetchStatus?: GlintCapture["urlFetchStatus"];
}

export interface InboxDiagnostics {
  inboxExists: boolean;
  outputExists: boolean;
  lastReceivedAt?: string | number;
  autoProcessRunning: boolean;
  isProcessing: boolean;
  queuedTasks: number;
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
