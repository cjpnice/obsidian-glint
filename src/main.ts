import * as fs from "fs/promises";
import * as path from "path";

import {
  Editor,
  type EventRef,
  MarkdownView,
  Notice,
  Plugin,
  requestUrl,
  TFile,
  TFolder,
  normalizePath
} from "obsidian";

import { assertProviderResponseOK, localAnalyze, openAIEndpoint, parseAnalysisJSON, systemPrompt, userPrompt } from "./analysis";
import { IOS_SHORTCUT_CLIPBOARD_URL, IOS_SHORTCUT_SHARE_SHEET_URL, MAX_PROCESSING_RETRIES, VIEW_TYPE_GLINT_INBOX_STATUS } from "./constants";
import { DEFAULT_SETTINGS, LEGACY_DEFAULT_FOLDERS } from "./defaults";
import { GlintSettingTab } from "./settings-tab";
import { GlintInboxStatusView } from "./status-view";
import { translate, type L10nKey } from "./i18n";
import {
  inboxEntryFromRaw,
  isCaptureFilename,
  markCaptureError,
  markCaptureProcessed,
  normalizeCapture,
  resetCaptureForReprocess,
  sortInboxEntries
} from "./inbox";
import { markdownForCapture } from "./markdown";
import {
  expandHome,
  isExternalPath,
  isLegacyShortcutsInboxPath,
  normalizeConfiguredPath
} from "./paths";
import {
  chooseCategoryLabel,
  chooseTagLabels,
  rankedLabels,
  taxonomyReferenceText
} from "./taxonomy";
import type {
  AnalysisResult,
  FetchedURLContent,
  GlintCapture,
  GlintSettings,
  InboxDiagnostics,
  InboxEntryStatus,
  InboxStatusSnapshot,
  ProcessCaptureResult,
  TaxonomyContext
} from "./types";
import { assessURLContentQuality, captureText, extractReadableTextFromHTML, shouldFetchURLContent } from "./url";
import { createId, defaultCategory, defaultTitle, firstLineTitle, formatError, looksLikeUrl, safeFilename } from "./utils";

interface InboxProcessOptions {
  quiet?: boolean;
  force?: boolean;
  ignoreRetryLimit?: boolean;
}

interface CaptureSourceMatch {
  external: boolean;
  path: string;
  file?: TFile;
  capture: GlintCapture;
}

export default class GlintCaptureOrganizerPlugin extends Plugin {
  settings: GlintSettings;
  private autoProcessCreateRef?: EventRef;
  private autoProcessIntervalId?: number;
  private inboxQueue: Promise<void> = Promise.resolve();
  private isInboxProcessing = false;
  private queuedInboxTasks = 0;
  private lastProcessStartedAt?: string;
  private lastProcessFinishedAt?: string;
  private lastProcessError?: string;

  t(key: L10nKey, values: Record<string, string | number> = {}): string {
    return translate(this.settings.language, key, values);
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new GlintSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_GLINT_INBOX_STATUS, (leaf) => new GlintInboxStatusView(leaf, this));
    this.addRibbonIcon("inbox", this.t("ribbon.openInboxStatus"), () => {
      void this.activateInboxStatusView();
    });

    this.addCommand({
      id: "process-inbox-now",
      name: this.t("command.processInbox"),
      callback: () => {
        void this.processInbox();
      }
    });

    this.addCommand({
      id: "retry-failed-inbox",
      name: this.t("command.retryFailedInbox"),
      callback: () => {
        void this.retryFailedInbox();
      }
    });

    this.addCommand({
      id: "reprocess-current-glint-note",
      name: this.t("command.reprocessCurrentNote"),
      callback: () => {
        void this.reprocessCurrentNote();
      }
    });

    this.addCommand({
      id: "capture-current-note",
      name: this.t("command.captureCurrentNote"),
      callback: () => {
        void this.captureCurrentNote();
      }
    });

    this.addCommand({
      id: "capture-selected-text",
      name: this.t("command.captureSelectedText"),
      editorCallback: (editor: Editor) => {
        void this.captureSelectedText(editor);
      }
    });

    this.addCommand({
      id: "capture-clipboard",
      name: this.t("command.captureClipboard"),
      callback: () => {
        void this.captureClipboard();
      }
    });

    this.addCommand({
      id: "open-inbox-status",
      name: this.t("command.openInboxStatus"),
      callback: () => {
        void this.activateInboxStatusView();
      }
    });

    this.app.workspace.onLayoutReady(() => {
      void this.ensureConfiguredFolders();
      this.applyAutoProcessSetting();
    });
  }

  onunload(): void {
    this.stopAutoProcessing();
  }

  applyAutoProcessSetting(): void {
    if (this.settings.autoProcessInbox) this.startAutoProcessing();
    else this.stopAutoProcessing();
  }

  startAutoProcessing(): void {
    if (this.autoProcessCreateRef || this.autoProcessIntervalId !== undefined) return;
    this.autoProcessCreateRef = this.app.vault.on("create", (file) => {
      if (file instanceof TFile && this.isInboxCapture(file)) {
        void this.processInboxFile(file, { quiet: true });
      }
    });
    this.autoProcessIntervalId = window.setInterval(() => {
      void this.processInbox({ quiet: true });
    }, 30_000);
    void this.processInbox({ quiet: true });
  }

  stopAutoProcessing(): void {
    if (this.autoProcessCreateRef) {
      this.app.vault.offref(this.autoProcessCreateRef);
      this.autoProcessCreateRef = undefined;
    }
    if (this.autoProcessIntervalId !== undefined) {
      window.clearInterval(this.autoProcessIntervalId);
      this.autoProcessIntervalId = undefined;
    }
  }

  async activateInboxStatusView(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_GLINT_INBOX_STATUS)[0];
    const leaf = existingLeaf ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_GLINT_INBOX_STATUS, active: true });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  refreshInboxStatusViews(delayMs = 100): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GLINT_INBOX_STATUS)) {
      const view = leaf.view;
      if (view instanceof GlintInboxStatusView) {
        view.requestRender(delayMs);
      }
    }
  }

  async loadSettings(): Promise<void> {
    const savedSettings = (await this.loadData()) as Partial<GlintSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, savedSettings);
    this.settings.language = this.settings.language === "en" ? "en" : "zh";
    let shouldSaveMigratedSettings = false;
    if (
      !savedSettings?.inboxFolder ||
      savedSettings.inboxFolder === LEGACY_DEFAULT_FOLDERS.inboxFolder ||
      savedSettings.inboxFolder === LEGACY_DEFAULT_FOLDERS.nestedInboxFolder ||
      isLegacyShortcutsInboxPath(savedSettings.inboxFolder)
    ) {
      this.settings.inboxFolder = DEFAULT_SETTINGS.inboxFolder;
      shouldSaveMigratedSettings = Boolean(savedSettings?.inboxFolder);
    }
    if (!savedSettings?.outputFolder || savedSettings.outputFolder === LEGACY_DEFAULT_FOLDERS.outputFolder) {
      this.settings.outputFolder = DEFAULT_SETTINGS.outputFolder;
      shouldSaveMigratedSettings = Boolean(savedSettings?.outputFolder);
    }
    this.normalizeSettings();
    if (shouldSaveMigratedSettings) await this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    this.normalizeSettings();
    await this.saveData(this.settings);
  }

  private normalizeSettings(): void {
    this.settings.inboxFolder = normalizeConfiguredPath(this.settings.inboxFolder || DEFAULT_SETTINGS.inboxFolder);
    this.settings.outputFolder = normalizePath(this.settings.outputFolder || DEFAULT_SETTINGS.outputFolder);
  }

  async ensureConfiguredFolders(): Promise<void> {
    await this.ensureInboxFolder();
    await this.ensureFolder(this.settings.outputFolder);
  }

  async ensureInboxFolder(): Promise<void> {
    if (isExternalPath(this.settings.inboxFolder)) {
      await fs.mkdir(expandHome(this.settings.inboxFolder), { recursive: true });
      return;
    }
    await this.ensureFolder(this.settings.inboxFolder);
  }

  async processInbox(options: InboxProcessOptions = {}): Promise<void> {
    return await this.enqueueInboxTask(() => this.processInboxUnlocked(options), options.quiet);
  }

  async processInboxFile(file: TFile, options: InboxProcessOptions = {}): Promise<boolean> {
    return await this.enqueueInboxTask(() => this.processInboxFileUnlocked(file, options), options.quiet);
  }

  async retryInboxEntry(filePath: string): Promise<void> {
    try {
      const processed = await this.enqueueInboxTask(async () => {
        return isExternalPath(this.settings.inboxFolder)
          ? await this.processExternalInboxFileUnlocked(filePath, { force: true })
          : await this.processVaultPathUnlocked(filePath, { force: true });
      });
      new Notice(processed ? this.t("notice.retryCount", { count: 1 }) : this.t("notice.retryLimitReached"));
    } catch (error) {
      new Notice(this.t("notice.processFileFailed", { name: path.basename(filePath), error: formatError(error) }));
    }
  }

  async reprocessInboxEntry(filePath: string): Promise<void> {
    try {
      const processed = await this.enqueueInboxTask(async () => {
        return isExternalPath(this.settings.inboxFolder)
          ? await this.processExternalInboxFileUnlocked(filePath, { force: true, ignoreRetryLimit: true })
          : await this.processVaultPathUnlocked(filePath, { force: true, ignoreRetryLimit: true });
      });
      new Notice(this.t("notice.reprocessedCount", { count: processed ? 1 : 0 }));
    } catch (error) {
      new Notice(this.t("notice.processFileFailed", { name: path.basename(filePath), error: formatError(error) }));
    }
  }

  async retryFailedInbox(): Promise<void> {
    const count = await this.enqueueInboxTask(async () => {
      await this.ensureConfiguredFolders();
      const sourceType = isExternalPath(this.settings.inboxFolder) ? "external" : "vault";
      const files = sourceType === "external" ? await this.readExternalInboxStatus() : await this.readVaultInboxStatus();
      const failed = files.filter((file) => Boolean(file.error) && !file.retryLimitReached);
      let processed = 0;
      for (const file of failed) {
        try {
          const didProcess =
            sourceType === "external"
              ? await this.processExternalInboxFileUnlocked(file.path, { force: true })
              : await this.processVaultPathUnlocked(file.path, { force: true });
          if (didProcess) processed += 1;
        } catch (error) {
          new Notice(this.t("notice.processFileFailed", { name: file.name, error: formatError(error) }));
        }
      }
      return processed;
    });

    new Notice(count ? this.t("notice.retryCount", { count }) : this.t("notice.noFailedCaptures"));
  }

  async reprocessCurrentNote(): Promise<void> {
    try {
      await this.enqueueInboxTask(async () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) throw new Error(this.t("notice.openNoteFirst"));

        const cache = this.app.metadataCache.getFileCache(view.file);
        const frontmatter: unknown = cache?.frontmatter;
        const captureId = String(
          frontmatterRecordValue(frontmatter, "capture_id") || frontmatterRecordValue(frontmatter, "glint_id") || ""
        ).trim();
        if (!captureId) throw new Error(this.t("notice.noGlintNote"));

        const source = await this.findCaptureById(captureId);
        if (source) {
          if (source.external) await this.processExternalInboxFileUnlocked(source.path, { force: true, ignoreRetryLimit: true });
          else if (source.file) await this.processInboxFileUnlocked(source.file, { force: true, ignoreRetryLimit: true });
        } else {
          new Notice(this.t("notice.captureSourceNotFound"));
          const raw = await this.app.vault.cachedRead(view.file);
          const source = frontmatterRecordValue(frontmatter, "source");
          const capturedAt = frontmatterRecordValue(frontmatter, "captured");
          const sourceURL = typeof source === "string" ? source : undefined;
          const captured = typeof capturedAt === "string" ? capturedAt : new Date().toISOString();
          await this.processCapture({
            id: captureId,
            title: view.file.basename,
            originalURL: sourceURL,
            text: raw,
            contentType: "markdown",
            captureMethod: this.t("captureMethod.generatedNote"),
            createdAt: captured
          });
        }
      });
      new Notice(this.t("notice.reprocessedCurrentNote"));
    } catch (error) {
      new Notice(formatError(error));
    }
  }

  private async enqueueInboxTask<T>(task: () => Promise<T>, quiet = false): Promise<T> {
    if (this.isInboxProcessing && !quiet) {
      new Notice(this.t("notice.processAlreadyRunning"));
    }

    this.queuedInboxTasks += 1;
    this.refreshInboxStatusViews();
    const run = this.inboxQueue.catch(() => undefined).then(async () => {
      this.queuedInboxTasks = Math.max(0, this.queuedInboxTasks - 1);
      this.isInboxProcessing = true;
      this.lastProcessStartedAt = new Date().toISOString();
      this.lastProcessError = undefined;
      this.refreshInboxStatusViews();
      try {
        const result = await task();
        this.lastProcessFinishedAt = new Date().toISOString();
        return result;
      } catch (error) {
        this.lastProcessError = formatError(error);
        this.lastProcessFinishedAt = new Date().toISOString();
        throw error;
      } finally {
        this.isInboxProcessing = false;
        this.refreshInboxStatusViews();
      }
    });

    this.inboxQueue = run.then(
      () => undefined,
      () => undefined
    );
    return await run;
  }

  private async processInboxUnlocked(options: InboxProcessOptions = {}): Promise<void> {
    await this.ensureConfiguredFolders();
    if (isExternalPath(this.settings.inboxFolder)) {
      return await this.processExternalInboxUnlocked(options);
    }

    const files = this.app.vault
      .getFiles()
      .filter((file) => this.isInboxCapture(file))
      .sort((left, right) => left.path.localeCompare(right.path));

    if (files.length === 0) {
      if (!options.quiet) new Notice(this.t("notice.inboxEmpty"));
      return;
    }

    let processed = 0;
    for (const file of files) {
      try {
        if (await this.processInboxFileUnlocked(file, options)) processed += 1;
      } catch (error) {
        new Notice(this.t("notice.processFileFailed", { name: file.name, error: formatError(error) }));
      }
    }

    if (!options.quiet) new Notice(this.t("notice.processedCount", { count: processed }));
  }

  private async processInboxFileUnlocked(file: TFile, options: InboxProcessOptions = {}): Promise<boolean> {
    const raw = await this.app.vault.cachedRead(file);
    const parsed = JSON.parse(raw) as GlintCapture;
    const capture = normalizeCapture(options.force ? resetCaptureForReprocess(parsed) : parsed, file.basename);
    if (capture.processed && !options.force) return false;
    if (!options.ignoreRetryLimit && (parsed.retryCount ?? 0) >= MAX_PROCESSING_RETRIES) return false;

    try {
      const result = await this.processCapture(capture);
      await this.app.vault.modify(file, JSON.stringify(markCaptureProcessed(result.capture, result.note.path), null, 2));
      this.refreshInboxStatusViews();
      return true;
    } catch (error) {
      await this.app.vault.modify(file, JSON.stringify(markCaptureError(capture, error), null, 2));
      this.refreshInboxStatusViews();
      throw error;
    }
  }

  private async processVaultPathUnlocked(filePath: string, options: InboxProcessOptions = {}): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) throw new Error(this.t("error.captureNotFound", { path: filePath }));
    return await this.processInboxFileUnlocked(file, options);
  }

  private async processExternalInboxUnlocked(options: InboxProcessOptions = {}): Promise<void> {
    const inboxPath = expandHome(this.settings.inboxFolder);
    const entries = await fs.readdir(inboxPath, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && isCaptureFilename(entry.name))
      .map((entry) => path.join(inboxPath, entry.name))
      .sort((left, right) => left.localeCompare(right));

    if (files.length === 0) {
      if (!options.quiet) new Notice(this.t("notice.inboxEmpty"));
      return;
    }

    let processed = 0;
    for (const filePath of files) {
      try {
        if (await this.processExternalInboxFileUnlocked(filePath, options)) processed += 1;
      } catch (error) {
        new Notice(this.t("notice.processFileFailed", { name: path.basename(filePath), error: formatError(error) }));
      }
    }

    if (!options.quiet) new Notice(this.t("notice.processedCount", { count: processed }));
  }

  private async processExternalInboxFileUnlocked(filePath: string, options: InboxProcessOptions = {}): Promise<boolean> {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as GlintCapture;
    const capture = normalizeCapture(options.force ? resetCaptureForReprocess(parsed) : parsed, path.basename(filePath, path.extname(filePath)));
    if (capture.processed && !options.force) return false;
    if (!options.ignoreRetryLimit && (parsed.retryCount ?? 0) >= MAX_PROCESSING_RETRIES) return false;

    try {
      const result = await this.processCapture(capture);
      await fs.writeFile(filePath, JSON.stringify(markCaptureProcessed(result.capture, result.note.path), null, 2), "utf8");
      this.refreshInboxStatusViews();
      return true;
    } catch (error) {
      await fs.writeFile(filePath, JSON.stringify(markCaptureError(capture, error), null, 2), "utf8");
      this.refreshInboxStatusViews();
      throw error;
    }
  }

  async getInboxStatusSnapshot(): Promise<InboxStatusSnapshot> {
    const sourceType = isExternalPath(this.settings.inboxFolder) ? "external" : "vault";
    const inboxExistsBeforeEnsure = await this.inboxFolderExists();
    await this.ensureInboxFolder();
    const files = sourceType === "external" ? await this.readExternalInboxStatus() : await this.readVaultInboxStatus();
    const invalid = files.filter((file) => file.error).length;
    const processed = files.filter((file) => !file.error && file.processed).length;
    const pending = files.filter((file) => !file.error && !file.processed).length;

    return {
      sourceType,
      inboxPath: sourceType === "external" ? expandHome(this.settings.inboxFolder) : this.settings.inboxFolder,
      outputFolder: this.settings.outputFolder,
      autoProcessInbox: this.settings.autoProcessInbox,
      providerLabel: this.providerLabel(),
      total: files.length,
      pending,
      processed,
      invalid,
      files: sortInboxEntries(files).slice(0, 100),
      diagnostics: await this.buildDiagnostics(files, inboxExistsBeforeEnsure),
      refreshedAt: new Date().toISOString()
    };
  }

  async readExternalInboxStatus(): Promise<InboxEntryStatus[]> {
    const inboxPath = expandHome(this.settings.inboxFolder);
    const entries = await fs.readdir(inboxPath, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && isCaptureFilename(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));

    return await Promise.all(
      files.map(async (entry) => {
        const filePath = path.join(inboxPath, entry.name);
        let modifiedAt: number | undefined;
        try {
          modifiedAt = (await fs.stat(filePath)).mtimeMs;
        } catch {
          modifiedAt = undefined;
        }

        try {
          const raw = await fs.readFile(filePath, "utf8");
          return inboxEntryFromRaw(entry.name, filePath, raw, modifiedAt);
        } catch (error) {
          return {
            name: entry.name,
            path: filePath,
            modifiedAt,
            processed: false,
            error: formatError(error)
          };
        }
      })
    );
  }

  async readVaultInboxStatus(): Promise<InboxEntryStatus[]> {
    const files = this.app.vault
      .getFiles()
      .filter((file) => this.isInboxCapture(file))
      .sort((left, right) => left.path.localeCompare(right.path));

    return await Promise.all(
      files.map(async (file) => {
        try {
          const raw = await this.app.vault.cachedRead(file);
          return inboxEntryFromRaw(file.name, file.path, raw, file.stat.mtime);
        } catch (error) {
          return {
            name: file.name,
            path: file.path,
            modifiedAt: file.stat.mtime,
            processed: false,
            error: formatError(error)
          };
        }
      })
    );
  }

  providerLabel(): string {
    if (this.settings.providerType === "local") return this.t("settings.providerLocal");
    if (this.settings.providerType === "ollama") return this.t("settings.providerOllama");
    return this.t("settings.providerOpenAI");
  }

  async captureCurrentNote(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) {
      new Notice(this.t("notice.openNoteFirst"));
      return;
    }

    const text = await this.app.vault.cachedRead(view.file);
    await this.processCapture({
      id: createId(),
      title: view.file.basename,
      text,
      note: view.file.path,
      contentType: "markdown",
      captureMethod: this.t("captureMethod.currentNote"),
      createdAt: new Date().toISOString()
    });
    new Notice(this.t("notice.capturedCurrentNote"));
  }

  async captureSelectedText(editor: Editor): Promise<void> {
    const text = editor.getSelection().trim();
    if (!text) {
      new Notice(this.t("notice.selectTextFirst"));
      return;
    }

    await this.processCapture({
      id: createId(),
      title: firstLineTitle(text, this.settings.language),
      text,
      contentType: "text",
      captureMethod: this.t("captureMethod.selection"),
      createdAt: new Date().toISOString()
    });
    new Notice(this.t("notice.capturedSelection"));
  }

  async captureClipboard(): Promise<void> {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        new Notice(this.t("notice.clipboardEmpty"));
        return;
      }

      await this.processCapture({
        id: createId(),
        title: looksLikeUrl(text) ? text : firstLineTitle(text, this.settings.language),
        originalURL: looksLikeUrl(text) ? text : undefined,
        text: looksLikeUrl(text) ? "" : text,
        note: looksLikeUrl(text) ? text : undefined,
        contentType: looksLikeUrl(text) ? "url" : "text",
        captureMethod: this.t("captureMethod.clipboard"),
        createdAt: new Date().toISOString()
      });
      new Notice(this.t("notice.capturedClipboard"));
    } catch (error) {
      new Notice(this.t("notice.clipboardReadFailed", { error: formatError(error) }));
    }
  }

  async processCapture(capture: GlintCapture): Promise<ProcessCaptureResult> {
    const normalized = normalizeCapture(capture);
    const enriched = await this.enrichURLCapture(normalized);
    const text = captureText(enriched);
    if (!text.trim()) {
      throw new Error(this.t("error.noText"));
    }

    const taxonomy = await this.collectTaxonomy();
    let analysis = await this.analyze(enriched, text, taxonomy);
    const taxonomyText = taxonomyReferenceText(enriched.title, enriched.originalURL, text, analysis);
    analysis.tags = chooseTagLabels(analysis.tags, taxonomyText, taxonomy.tags, 10);
    analysis.category = chooseCategoryLabel(analysis.category, taxonomyText, taxonomy.categories, this.settings.language);
    const note = await this.writeMarkdown(enriched, analysis);
    return { capture: enriched, note };
  }

  async enrichURLCapture(capture: GlintCapture): Promise<GlintCapture> {
    if (!this.settings.fetchUrlContent || !shouldFetchURLContent(capture)) return capture;
    const url = capture.originalURL;
    if (!url) return capture;

    const fetched = await this.fetchURLContent(url);
    if (!fetched?.text.trim()) {
      return {
        ...capture,
        urlFetchStatus: "failed",
        urlFetchWarning: this.t("warning.urlFetchFailed"),
        urlFetchTextLength: 0
      };
    }

    const qualityWarning = assessURLContentQuality(fetched, this.settings.language);
    if (qualityWarning) {
      return {
        ...capture,
        title: this.bestFetchedTitle(capture, fetched),
        urlFetchStatus: "insufficient",
        urlFetchWarning: qualityWarning,
        urlFetchTextLength: fetched.text.length
      };
    }

    return {
      ...capture,
      title: this.bestFetchedTitle(capture, fetched),
      text: fetched.title ? `# ${fetched.title}\n\n${fetched.text}` : fetched.text,
      urlFetchStatus: "ok",
      urlFetchWarning: undefined,
      urlFetchTextLength: fetched.text.length
    };
  }

  async fetchURLContent(url: string): Promise<FetchedURLContent | null> {
    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
          "Accept-Language": this.settings.language === "zh" ? "zh-CN,zh;q=0.9,en;q=0.7" : "en-US,en;q=0.9,zh-CN;q=0.6"
        }
      });
      return extractReadableTextFromHTML(response.text);
    } catch {
      return null;
    }
  }

  async analyze(capture: GlintCapture, text: string, taxonomy: TaxonomyContext): Promise<AnalysisResult> {
    if (this.settings.providerType === "ollama") {
      return (await this.analyzeWithOllama(capture, text, taxonomy)) ?? localAnalyze(capture, text, taxonomy, this.settings.language);
    }
    if (this.settings.providerType === "openai-compatible") {
      return (await this.analyzeWithOpenAICompatible(capture, text, taxonomy)) ?? localAnalyze(capture, text, taxonomy, this.settings.language);
    }
    return localAnalyze(capture, text, taxonomy, this.settings.language);
  }

  async analyzeWithOllama(
    capture: GlintCapture,
    text: string,
    taxonomy: TaxonomyContext
  ): Promise<AnalysisResult | null> {
    if (!this.settings.modelName.trim()) return null;
    try {
      const response = await requestUrl({
        url: this.settings.endpointUrl || DEFAULT_SETTINGS.endpointUrl,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.settings.modelName,
          stream: false,
          messages: [
            { role: "system", content: systemPrompt(this.settings.language) },
            { role: "user", content: userPrompt(capture, text, taxonomy, this.settings.language) }
          ]
        })
      });
      const content = ollamaMessageContent(response.json as unknown);
      return typeof content === "string" ? parseAnalysisJSON(content, "Ollama", this.settings.modelName, this.settings.language) : null;
    } catch {
      return null;
    }
  }

  async analyzeWithOpenAICompatible(
    capture: GlintCapture,
    text: string,
    taxonomy: TaxonomyContext
  ): Promise<AnalysisResult | null> {
    if (!this.settings.modelName.trim()) return null;
    const endpoint = openAIEndpoint(this.settings.endpointUrl);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.settings.apiKey.trim()) headers.Authorization = `Bearer ${this.settings.apiKey.trim()}`;
      const response = await requestUrl({
        url: endpoint,
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.settings.modelName,
          temperature: this.settings.temperature,
          messages: [
            { role: "system", content: systemPrompt(this.settings.language) },
            { role: "user", content: userPrompt(capture, text, taxonomy, this.settings.language) }
          ]
        })
      });
      const content = openAIChoiceContent(response.json as unknown);
      return typeof content === "string"
        ? parseAnalysisJSON(content, "OpenAI-compatible", this.settings.modelName, this.settings.language)
        : null;
    } catch {
      return null;
    }
  }

  async testProvider(): Promise<void> {
    new Notice(this.t("notice.providerTestStarted"));
    this.settings.lastProviderTestAt = new Date().toISOString();
    try {
      if (this.settings.providerType === "local") {
        this.settings.lastProviderTestOk = true;
        this.settings.lastProviderTestError = undefined;
        await this.saveSettings();
        new Notice(this.t("notice.providerTestSucceeded", { provider: this.providerLabel() }));
        return;
      }

      if (this.settings.providerType === "ollama") {
        await this.testOllamaProvider();
      } else {
        await this.testOpenAICompatibleProvider();
      }
      this.settings.lastProviderTestOk = true;
      this.settings.lastProviderTestError = undefined;
      await this.saveSettings();
      new Notice(this.t("notice.providerTestSucceeded", { provider: this.providerLabel() }));
    } catch (error) {
      this.settings.lastProviderTestOk = false;
      this.settings.lastProviderTestError = formatError(error);
      await this.saveSettings();
      new Notice(this.t("notice.providerTestFailed", { error: formatError(error) }));
    }
  }

  async testOllamaProvider(): Promise<void> {
    const model = this.settings.modelName.trim();
    if (!model) throw new Error(this.t("error.noModel"));
    const response = await requestUrl({
      url: this.settings.endpointUrl || DEFAULT_SETTINGS.endpointUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: "You are a health check endpoint. Reply with OK only." },
          { role: "user", content: "OK" }
        ]
      })
    });
    assertProviderResponseOK(response.status, ollamaMessageContent(response.json as unknown), this.settings.language);
  }

  async testOpenAICompatibleProvider(): Promise<void> {
    const model = this.settings.modelName.trim();
    if (!model) throw new Error(this.t("error.noModel"));
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.settings.apiKey.trim()) headers.Authorization = `Bearer ${this.settings.apiKey.trim()}`;

    const response = await requestUrl({
      url: openAIEndpoint(this.settings.endpointUrl),
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 8,
        messages: [
          { role: "system", content: "You are a health check endpoint. Reply with OK only." },
          { role: "user", content: "OK" }
        ]
      })
    });
    assertProviderResponseOK(response.status, openAIChoiceContent(response.json as unknown), this.settings.language);
  }

  async copyIOSShortcutShareSheetLink(): Promise<void> {
    await this.copyIOSShortcutLink(IOS_SHORTCUT_SHARE_SHEET_URL, this.t("settings.shortcutShareSheetURL"));
  }

  async copyIOSShortcutClipboardLink(): Promise<void> {
    await this.copyIOSShortcutLink(IOS_SHORTCUT_CLIPBOARD_URL, this.t("settings.shortcutClipboardURL"));
  }

  private async copyIOSShortcutLink(url: string, name: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      new Notice(this.t("notice.shortcutLinkCopied", { name }));
    } catch (error) {
      new Notice(this.t("notice.shortcutLinkCopyFailed", { name, error: formatError(error) }));
    }
  }

  async collectTaxonomy(): Promise<TaxonomyContext> {
    const outputPrefix = `${normalizePath(this.settings.outputFolder)}/`;
    const categories: string[] = [];
    const tags: string[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(outputPrefix)) continue;
      const frontmatter: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const category = frontmatterRecordValue(frontmatter, "category");
      if (typeof category === "string" && category.trim()) categories.push(category.trim());

      const rawTags = frontmatterRecordValue(frontmatter, "tags");
      if (Array.isArray(rawTags)) {
        tags.push(...rawTags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()));
      } else if (typeof rawTags === "string") {
        tags.push(...rawTags.split(/[,\n]/).map((tag) => tag.trim()));
      }
    }

    return {
      categories: rankedLabels(categories, this.settings.maxExistingCategories),
      tags: rankedLabels(tags, this.settings.maxExistingTags)
    };
  }

  async writeMarkdown(capture: GlintCapture, analysis: AnalysisResult): Promise<TFile> {
    await this.ensureFolder(this.settings.outputFolder);
    const categoryFolder = normalizePath(
      `${this.settings.outputFolder}/${safeFilename(analysis.category || defaultCategory(this.settings.language), this.settings.language)}`
    );
    await this.ensureFolder(categoryFolder);

    const captureId = capture.id ?? createId();
    const existing = await this.findExistingNote(captureId);
    const preferredPath = normalizePath(
      `${categoryFolder}/${safeFilename(analysis.title || capture.title || defaultTitle(this.settings.language), this.settings.language)}-${captureId.slice(0, 8)}.md`
    );
    const targetPath = await this.availablePath(preferredPath, existing?.path);
    const content = markdownForCapture(capture, analysis, this.settings.language);

    if (existing) {
      if (existing.path !== targetPath) {
        await this.app.fileManager.trashFile(existing);
        return await this.app.vault.create(targetPath, content);
      }
      await this.app.vault.modify(existing, content);
      return existing;
    }

    return await this.app.vault.create(targetPath, content);
  }

  async findExistingNote(captureId: string): Promise<TFile | null> {
    const outputPrefix = `${normalizePath(this.settings.outputFolder)}/`;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(outputPrefix)) continue;
      const frontmatter: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (frontmatterRecordValue(frontmatter, "capture_id") === captureId || frontmatterRecordValue(frontmatter, "glint_id") === captureId) return file;
    }
    return null;
  }

  async availablePath(preferredPath: string, allowedExistingPath?: string): Promise<string> {
    if (allowedExistingPath === preferredPath) return preferredPath;
    if (!this.app.vault.getAbstractFileByPath(preferredPath)) return preferredPath;

    const dot = preferredPath.lastIndexOf(".");
    const base = dot === -1 ? preferredPath : preferredPath.slice(0, dot);
    const ext = dot === -1 ? "" : preferredPath.slice(dot);
    for (let index = 2; index < 10_000; index += 1) {
      const candidate = `${base}-${index}${ext}`;
      if (allowedExistingPath === candidate || !this.app.vault.getAbstractFileByPath(candidate)) return candidate;
    }
    throw new Error(this.t("error.noAvailablePath", { path: preferredPath }));
  }

  async ensureFolder(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath);
    if (!normalized) return;

    let current = "";
    for (const part of normalized.split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(this.t("error.pathNotFolder", { path: current }));
      await this.app.vault.createFolder(current);
    }
  }

  isInboxCapture(file: TFile): boolean {
    if (isExternalPath(this.settings.inboxFolder)) return false;
    const inboxPrefix = `${normalizePath(this.settings.inboxFolder)}/`;
    const name = file.name.toLowerCase();
    return file.path.startsWith(inboxPrefix) && file.extension.toLowerCase() === "json" && name.includes("glintcapture");
  }

  private bestFetchedTitle(capture: GlintCapture, fetched: FetchedURLContent): string | undefined {
    const existingTitle = capture.title?.trim();
    return existingTitle && !looksLikeUrl(existingTitle) ? existingTitle : fetched.title ?? existingTitle;
  }

  private async findCaptureById(captureId: string): Promise<CaptureSourceMatch | null> {
    if (isExternalPath(this.settings.inboxFolder)) {
      const inboxPath = expandHome(this.settings.inboxFolder);
      const entries = await fs.readdir(inboxPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !isCaptureFilename(entry.name)) continue;
        const filePath = path.join(inboxPath, entry.name);
        try {
          const capture = JSON.parse(await fs.readFile(filePath, "utf8")) as GlintCapture;
          const normalized = normalizeCapture(capture, path.basename(filePath, path.extname(filePath)));
          if (normalized.id === captureId) return { external: true, path: filePath, capture: normalized };
        } catch {
          continue;
        }
      }
      return null;
    }

    for (const file of this.app.vault.getFiles().filter((candidate) => this.isInboxCapture(candidate))) {
      try {
        const capture = JSON.parse(await this.app.vault.cachedRead(file)) as GlintCapture;
        const normalized = normalizeCapture(capture, file.basename);
        if (normalized.id === captureId) return { external: false, path: file.path, file, capture: normalized };
      } catch {
        continue;
      }
    }
    return null;
  }

  private async buildDiagnostics(files: InboxEntryStatus[], inboxExistsBeforeEnsure: boolean): Promise<InboxDiagnostics> {
    return {
      inboxExists: inboxExistsBeforeEnsure || (await this.inboxFolderExists()),
      outputExists: this.outputFolderExists(),
      lastReceivedAt: this.latestInboxTimestamp(files),
      autoProcessRunning: this.autoProcessCreateRef !== undefined || this.autoProcessIntervalId !== undefined,
      isProcessing: this.isInboxProcessing,
      queuedTasks: this.queuedInboxTasks,
      lastProcessStartedAt: this.lastProcessStartedAt,
      lastProcessFinishedAt: this.lastProcessFinishedAt,
      lastProcessError: this.lastProcessError,
      lastProviderTestAt: this.settings.lastProviderTestAt,
      lastProviderTestOk: this.settings.lastProviderTestOk,
      lastProviderTestError: this.settings.lastProviderTestError,
      urlWarnings: files.filter((file) => Boolean(file.urlFetchWarning)).length
    };
  }

  private async inboxFolderExists(): Promise<boolean> {
    if (isExternalPath(this.settings.inboxFolder)) {
      try {
        return (await fs.stat(expandHome(this.settings.inboxFolder))).isDirectory();
      } catch {
        return false;
      }
    }
    return this.app.vault.getAbstractFileByPath(normalizePath(this.settings.inboxFolder)) instanceof TFolder;
  }

  private outputFolderExists(): boolean {
    return this.app.vault.getAbstractFileByPath(normalizePath(this.settings.outputFolder)) instanceof TFolder;
  }

  private latestInboxTimestamp(files: InboxEntryStatus[]): string | number | undefined {
    let latest: string | number | undefined;
    let latestMs = 0;
    for (const file of files) {
      const candidates = [file.createdAt, file.modifiedAt].filter((value): value is string | number => value !== undefined);
      for (const candidate of candidates) {
        const time = new Date(candidate).getTime();
        if (!Number.isNaN(time) && time > latestMs) {
          latestMs = time;
          latest = candidate;
        }
      }
    }
    return latest;
  }
}

function frontmatterRecordValue(frontmatter: unknown, key: string): unknown {
  return isRecord(frontmatter) ? frontmatter[key] : undefined;
}

function ollamaMessageContent(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  const message = value.message;
  return isRecord(message) ? message.content : undefined;
}

function openAIChoiceContent(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  const choices = value.choices;
  if (!Array.isArray(choices)) return undefined;
  const first = choices[0];
  if (!isRecord(first)) return undefined;
  const message = first.message;
  return isRecord(message) ? message.content : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
