import { ItemView, WorkspaceLeaf } from "obsidian";

import type GlintCaptureOrganizerPlugin from "./main";
import { VIEW_TYPE_GLINT_INBOX_STATUS } from "./constants";
import type { InboxEntryStatus, InboxStatusSnapshot } from "./types";
import { formatDateTime, formatError } from "./utils";

export class GlintInboxStatusView extends ItemView {
  plugin: GlintCaptureOrganizerPlugin;

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
    await this.render();
  }

  async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("glint-status-view");
    container.createDiv({ cls: "glint-status-loading", text: this.plugin.t("view.loading") });

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
    this.renderDetail(panel, this.plugin.t("view.inboxExists"), diagnostics.inboxExists ? this.plugin.t("view.enabled") : this.plugin.t("view.disabled"));
    this.renderDetail(panel, this.plugin.t("view.outputExists"), diagnostics.outputExists ? this.plugin.t("view.enabled") : this.plugin.t("view.disabled"));
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
    panel.createEl("h3", { text: this.plugin.t("view.recentCaptures") });

    if (!snapshot.files.length) {
      panel.createDiv({ cls: "glint-status-empty", text: this.plugin.t("view.empty") });
      return;
    }

    const list = panel.createDiv({ cls: "glint-status-file-list" });
    for (const file of snapshot.files) {
      this.renderFileRow(list, file);
    }
  }

  private renderFileRow(container: HTMLElement, file: InboxEntryStatus): void {
    const status = file.error ? "invalid" : file.processed ? "processed" : "pending";
    const row = container.createDiv({ cls: `glint-status-file glint-status-file-${status}` });
    const top = row.createDiv({ cls: "glint-status-file-top" });
    top.createDiv({ cls: "glint-status-file-title", text: file.title || file.name });
    top.createDiv({ cls: "glint-status-file-badge", text: this.statusLabel(file) });
    row.createDiv({ cls: "glint-status-file-path", text: file.path });

    const meta = row.createDiv({ cls: "glint-status-file-meta" });
    if (file.createdAt) meta.createSpan({ text: `${this.plugin.t("view.createdAt")}: ${formatDateTime(file.createdAt, this.plugin.settings.language)}` });
    if (file.processedAt) meta.createSpan({ text: `${this.plugin.t("view.processedAt")}: ${formatDateTime(file.processedAt, this.plugin.settings.language)}` });
    if (file.retryCount) meta.createSpan({ text: this.plugin.t("view.retryCount", { count: file.retryCount }) });
    if (file.processedNotePath) {
      const noteButton = meta.createEl("button", { cls: "glint-status-link-button", text: this.plugin.t("view.openNote") });
      noteButton.addEventListener("click", () => {
        void this.app.workspace.openLinkText(file.processedNotePath ?? "", "", false);
      });
    }

    const actions = meta.createSpan({ cls: "glint-status-row-actions" });
    if (file.error) {
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

    if (file.urlFetchWarning) row.createDiv({ cls: "glint-status-warning", text: `${this.plugin.t("view.fetchWarning")}: ${file.urlFetchWarning}` });
    if (file.error) row.createDiv({ cls: "glint-status-error", text: `${this.plugin.t("view.error")}: ${file.error}` });
  }

  private statusLabel(file: InboxEntryStatus): string {
    if (file.error) return file.retryCount ? this.plugin.t("view.statusFailed") : this.plugin.t("view.statusInvalid");
    if (file.processed) return this.plugin.t("view.statusProcessed");
    return this.plugin.t("view.statusPending");
  }
}
