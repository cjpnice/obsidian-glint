import { ItemView, WorkspaceLeaf } from "obsidian";

import type GlintCaptureOrganizerPlugin from "./main";
import { VIEW_TYPE_GLINT_INBOX_STATUS } from "./constants";
import type { InboxEntryStatus, InboxStatusSnapshot } from "./types";
import { formatDateTime, formatError } from "./utils";

type CaptureFilter = "all" | "pending" | "processed" | "failed";

const FILES_PER_PAGE = 25;

export class GlintInboxStatusView extends ItemView {
  plugin: GlintCaptureOrganizerPlugin;
  private refreshTimeoutId?: number;
  private renderInFlight = false;
  private renderAgainAfterCurrent = false;
  private captureFilter: CaptureFilter = "all";
  private captureQuery = "";
  private capturePage = 0;

  constructor(leaf: WorkspaceLeaf, plugin: GlintCaptureOrganizerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_GLINT_INBOX_STATUS;
  }

  getDisplayText(): string {
    return this.plugin.t("view.title");
  }

  getIcon(): string {
    return "inbox";
  }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.vault.on("create", () => this.requestRender()));
    this.registerEvent(this.app.vault.on("modify", () => this.requestRender()));
    this.registerEvent(this.app.vault.on("delete", () => this.requestRender()));
    this.registerInterval(window.setInterval(() => this.requestRender(), 5_000));
    await this.render();
  }

  async onClose(): Promise<void> {
    if (this.refreshTimeoutId !== undefined) {
      window.clearTimeout(this.refreshTimeoutId);
      this.refreshTimeoutId = undefined;
    }
  }

  requestRender(delayMs = 250): void {
    if (this.refreshTimeoutId !== undefined) {
      window.clearTimeout(this.refreshTimeoutId);
    }
    this.refreshTimeoutId = window.setTimeout(() => {
      this.refreshTimeoutId = undefined;
      void this.render(false);
    }, delayMs);
  }

  async render(showLoading = true): Promise<void> {
    if (this.renderInFlight) {
      this.renderAgainAfterCurrent = true;
      return;
    }

    this.renderInFlight = true;
    try {
      const container = this.contentEl;
      if (showLoading || !container.children.length) {
        container.empty();
        container.addClass("glint-status-view");
        container.createDiv({ cls: "glint-status-loading", text: this.plugin.t("view.loading") });
      }

      try {
        const snapshot = await this.plugin.getInboxStatusSnapshot();
        container.empty();
        container.addClass("glint-status-view");
        this.renderHeader(container, snapshot);
        this.renderStats(container, snapshot);
        this.renderDetails(container, snapshot);
        this.renderDiagnostics(container, snapshot);
        this.renderFiles(container, snapshot);
      } catch (error) {
        container.empty();
        container.addClass("glint-status-view");
        const panel = container.createDiv({ cls: "glint-status-panel glint-status-error-panel" });
        panel.createEl("h3", { text: this.plugin.t("view.error") });
        panel.createDiv({ cls: "glint-status-error", text: formatError(error) });
        this.renderActions(panel);
      }
    } finally {
      this.renderInFlight = false;
      if (this.renderAgainAfterCurrent) {
        this.renderAgainAfterCurrent = false;
        this.requestRender(50);
      }
    }
  }

  private renderHeader(container: HTMLElement, snapshot: InboxStatusSnapshot): void {
    const header = container.createDiv({ cls: "glint-status-header" });
    const titleGroup = header.createDiv();
    titleGroup.createEl("h2", { text: this.plugin.t("view.title") });
    titleGroup.createDiv({ cls: "glint-status-subtitle", text: this.plugin.t("view.subtitle") });
    titleGroup.createDiv({ cls: "glint-status-refreshed", text: this.plugin.t("view.refreshedAt", { time: formatDateTime(snapshot.refreshedAt, this.plugin.settings.language) }) });
    this.renderActions(header);
  }

  private renderActions(container: HTMLElement): void {
    const actions = container.createDiv({ cls: "glint-status-actions" });
    const refreshButton = actions.createEl("button", { cls: "glint-status-button", text: this.plugin.t("view.refresh") });
    refreshButton.addEventListener("click", () => {
      void this.render();
    });

    const retryButton = actions.createEl("button", { cls: "glint-status-button", text: this.plugin.t("view.retryAllFailed") });
    retryButton.addEventListener("click", async () => {
      retryButton.disabled = true;
      await this.plugin.retryFailedInbox();
      await this.render();
    });

    const processButton = actions.createEl("button", { cls: "glint-status-button glint-status-button-primary", text: this.plugin.t("view.processNow") });
    processButton.addEventListener("click", async () => {
      processButton.disabled = true;
      await this.plugin.processInbox();
      await this.render();
    });
  }

  private renderStats(container: HTMLElement, snapshot: InboxStatusSnapshot): void {
    const grid = container.createDiv({ cls: "glint-status-grid" });
    this.renderStatCard(grid, this.plugin.t("view.pending"), snapshot.pending, "pending");
    this.renderStatCard(grid, this.plugin.t("view.processed"), snapshot.processed, "processed");
    this.renderStatCard(grid, this.plugin.t("view.invalid"), snapshot.invalid, "invalid");
    this.renderStatCard(grid, this.plugin.t("view.total"), snapshot.total, "total");
  }

  private renderStatCard(container: HTMLElement, label: string, value: number, tone: string): void {
    const card = container.createDiv({ cls: `glint-status-card glint-status-card-${tone}` });
    card.createDiv({ cls: "glint-status-card-value", text: String(value) });
    card.createDiv({ cls: "glint-status-card-label", text: label });
  }

  private renderDetails(container: HTMLElement, snapshot: InboxStatusSnapshot): void {
    const panel = container.createDiv({ cls: "glint-status-panel" });
    panel.createEl("h3", { text: snapshot.sourceType === "external" ? this.plugin.t("view.sourceExternal") : this.plugin.t("view.sourceVault") });
    this.renderDetail(panel, this.plugin.t("view.inboxPath"), snapshot.inboxPath);
    this.renderDetail(panel, this.plugin.t("view.outputFolder"), snapshot.outputFolder);
    this.renderDetail(panel, this.plugin.t("view.autoProcess"), snapshot.autoProcessInbox ? this.plugin.t("view.enabled") : this.plugin.t("view.disabled"));
    this.renderDetail(panel, this.plugin.t("view.provider"), snapshot.providerLabel);
  }

  private renderDiagnostics(container: HTMLElement, snapshot: InboxStatusSnapshot): void {
    const diagnostics = snapshot.diagnostics;
    const panel = container.createDiv({ cls: "glint-status-panel" });
    panel.createEl("h3", { text: this.plugin.t("view.diagnostics") });
    this.renderDetail(
      panel,
      this.plugin.t("view.lastReceived"),
      diagnostics.lastReceivedAt ? formatDateTime(diagnostics.lastReceivedAt, this.plugin.settings.language) : this.plugin.t("view.noRecentFile")
    );
    this.renderDetail(panel, this.plugin.t("view.autoProcessor"), diagnostics.autoProcessRunning ? this.plugin.t("view.running") : this.plugin.t("view.idle"));
    this.renderDetail(
      panel,
      this.plugin.t("view.processingQueue"),
      `${diagnostics.isProcessing ? this.plugin.t("view.running") : this.plugin.t("view.idle")} / ${this.plugin.t("view.queuedTasks", { count: diagnostics.queuedTasks })}`
    );
    this.renderDetail(
      panel,
      this.plugin.t("view.lastRun"),
      diagnostics.lastProcessFinishedAt
        ? `${formatDateTime(diagnostics.lastProcessFinishedAt, this.plugin.settings.language)}${diagnostics.lastProcessError ? ` / ${diagnostics.lastProcessError}` : ""}`
        : this.plugin.t("view.noRun")
    );
    this.renderDetail(panel, this.plugin.t("view.providerTest"), this.providerTestLabel(snapshot));
    this.renderDetail(panel, this.plugin.t("view.urlWarnings"), String(diagnostics.urlWarnings));
  }

  private providerTestLabel(snapshot: InboxStatusSnapshot): string {
    const diagnostics = snapshot.diagnostics;
    if (!diagnostics.lastProviderTestAt) return this.plugin.t("view.notTested");
    const status = diagnostics.lastProviderTestOk ? this.plugin.t("view.success") : this.plugin.t("view.failed");
    const time = formatDateTime(diagnostics.lastProviderTestAt, this.plugin.settings.language);
    return diagnostics.lastProviderTestError ? `${status} / ${time} / ${diagnostics.lastProviderTestError}` : `${status} / ${time}`;
  }

  private renderDetail(container: HTMLElement, label: string, value: string): void {
    const row = container.createDiv({ cls: "glint-status-detail" });
    row.createDiv({ cls: "glint-status-detail-label", text: label });
    row.createDiv({ cls: "glint-status-detail-value", text: value });
  }

  private renderFiles(container: HTMLElement, snapshot: InboxStatusSnapshot): void {
    const panel = container.createDiv({ cls: "glint-status-panel" });
    const header = panel.createDiv({ cls: "glint-status-list-header" });
    header.createEl("h3", { text: this.plugin.t("view.recentCaptures") });

    if (!snapshot.files.length) {
      panel.createDiv({ cls: "glint-status-empty", text: this.plugin.t("view.empty") });
      return;
    }

    const controls = panel.createDiv({ cls: "glint-status-list-controls" });
    this.renderFilterButton(controls, "all", snapshot.total);
    this.renderFilterButton(controls, "pending", snapshot.pending);
    this.renderFilterButton(controls, "processed", snapshot.processed);
    this.renderFilterButton(controls, "failed", snapshot.invalid);

    const search = controls.createEl("input", {
      cls: "glint-status-search",
      attr: {
        type: "search",
        placeholder: this.plugin.t("view.searchPlaceholder")
      }
    });
    search.value = this.captureQuery;
    search.addEventListener("input", () => {
      this.captureQuery = search.value;
      this.capturePage = 0;
      void this.render(false);
    });

    const filtered = this.filteredFiles(snapshot.files);
    const pageCount = Math.max(1, Math.ceil(filtered.length / FILES_PER_PAGE));
    this.capturePage = Math.min(this.capturePage, pageCount - 1);
    const start = this.capturePage * FILES_PER_PAGE;
    const visible = filtered.slice(start, start + FILES_PER_PAGE);
    panel.createDiv({
      cls: "glint-status-list-summary",
      text: this.plugin.t("view.showingCaptures", {
        shown: visible.length,
        total: filtered.length,
        all: snapshot.total
      })
    });

    if (!visible.length) {
      panel.createDiv({ cls: "glint-status-empty", text: this.plugin.t("view.noMatchingCaptures") });
      return;
    }

    const list = panel.createDiv({ cls: "glint-status-file-list" });
    for (const file of visible) {
      this.renderFileRow(list, file);
    }

    if (pageCount > 1) {
      this.renderPagination(panel, pageCount);
    }
  }

  private renderFilterButton(container: HTMLElement, filter: CaptureFilter, count: number): void {
    const button = container.createEl("button", {
      cls: `glint-status-filter ${this.captureFilter === filter ? "is-active" : ""}`,
      text: `${this.filterLabel(filter)} ${count}`
    });
    button.addEventListener("click", () => {
      this.captureFilter = filter;
      this.capturePage = 0;
      void this.render(false);
    });
  }

  private filteredFiles(files: InboxEntryStatus[]): InboxEntryStatus[] {
    const query = this.captureQuery.trim().toLowerCase();
    return files.filter((file) => {
      if (this.captureFilter === "pending" && (file.error || file.processed)) return false;
      if (this.captureFilter === "processed" && (file.error || !file.processed)) return false;
      if (this.captureFilter === "failed" && !file.error) return false;
      if (!query) return true;
      return [file.name, file.title, file.path, file.error, file.processedNotePath]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
    });
  }

  private renderPagination(container: HTMLElement, pageCount: number): void {
    const pagination = container.createDiv({ cls: "glint-status-pagination" });
    const prev = pagination.createEl("button", { cls: "glint-status-button", text: this.plugin.t("view.previousPage") });
    prev.disabled = this.capturePage <= 0;
    prev.addEventListener("click", () => {
      this.capturePage = Math.max(0, this.capturePage - 1);
      void this.render(false);
    });

    pagination.createSpan({
      cls: "glint-status-page-label",
      text: this.plugin.t("view.pageLabel", { current: this.capturePage + 1, total: pageCount })
    });

    const next = pagination.createEl("button", { cls: "glint-status-button", text: this.plugin.t("view.nextPage") });
    next.disabled = this.capturePage >= pageCount - 1;
    next.addEventListener("click", () => {
      this.capturePage = Math.min(pageCount - 1, this.capturePage + 1);
      void this.render(false);
    });
  }

  private filterLabel(filter: CaptureFilter): string {
    if (filter === "pending") return this.plugin.t("view.pending");
    if (filter === "processed") return this.plugin.t("view.processed");
    if (filter === "failed") return this.plugin.t("view.invalid");
    return this.plugin.t("view.total");
  }

  private renderFileRow(container: HTMLElement, file: InboxEntryStatus): void {
    const status = file.error ? "invalid" : file.processed ? "processed" : "pending";
    const row = container.createDiv({ cls: `glint-status-file glint-status-file-${status}` });
    const top = row.createDiv({ cls: "glint-status-file-top" });
    top.createDiv({ cls: "glint-status-file-title", text: file.title || file.name });
    top.createDiv({ cls: "glint-status-file-badge", text: this.statusLabel(file) });
    const pathEl = row.createDiv({ cls: "glint-status-file-path", text: this.compactPath(file.path) });
    pathEl.title = file.path;

    const meta = row.createDiv({ cls: "glint-status-file-meta" });
    if (file.createdAt) meta.createSpan({ text: `${this.plugin.t("view.createdAt")}: ${formatDateTime(file.createdAt, this.plugin.settings.language)}` });
    if (file.processedAt) meta.createSpan({ text: `${this.plugin.t("view.processedAt")}: ${formatDateTime(file.processedAt, this.plugin.settings.language)}` });
    if (file.retryCount) meta.createSpan({ text: this.plugin.t("view.retryCount", { count: file.retryCount }) });
    if (file.retryLimitReached) meta.createSpan({ text: this.plugin.t("view.statusRetryLimit") });
    if (file.processedNotePath) {
      const noteButton = meta.createEl("button", { cls: "glint-status-link-button", text: this.plugin.t("view.openNote") });
      noteButton.addEventListener("click", () => {
        void this.app.workspace.openLinkText(file.processedNotePath ?? "", "", false);
      });
    }

    const actions = meta.createSpan({ cls: "glint-status-row-actions" });
    if (file.error && !file.retryLimitReached) {
      const retryButton = actions.createEl("button", { cls: "glint-status-link-button", text: this.plugin.t("view.retry") });
      retryButton.addEventListener("click", async () => {
        retryButton.disabled = true;
        await this.plugin.retryInboxEntry(file.path);
        await this.render();
      });
    }
    if (!file.error && file.processed) {
      const reprocessButton = actions.createEl("button", { cls: "glint-status-link-button", text: this.plugin.t("view.reprocess") });
      reprocessButton.addEventListener("click", async () => {
        reprocessButton.disabled = true;
        await this.plugin.reprocessInboxEntry(file.path);
        await this.render();
      });
    }

    if (file.retryLimitReached) row.createDiv({ cls: "glint-status-warning", text: this.plugin.t("view.retryLimitReached") });
    if (file.urlFetchWarning) row.createDiv({ cls: "glint-status-warning", text: `${this.plugin.t("view.fetchWarning")}: ${file.urlFetchWarning}` });
    if (file.error) row.createDiv({ cls: "glint-status-error", text: `${this.plugin.t("view.error")}: ${file.error}` });
  }

  private statusLabel(file: InboxEntryStatus): string {
    if (file.retryLimitReached) return this.plugin.t("view.statusRetryLimit");
    if (file.error) return file.retryCount ? this.plugin.t("view.statusFailed") : this.plugin.t("view.statusInvalid");
    if (file.processed) return this.plugin.t("view.statusProcessed");
    return this.plugin.t("view.statusPending");
  }

  private compactPath(value: string): string {
    const normalized = value.replace(/\\/g, "/");
    const parts = normalized.split("/");
    if (parts.length <= 4) return value;
    return `${parts.slice(0, 2).join("/")}/.../${parts.slice(-2).join("/")}`;
  }
}
