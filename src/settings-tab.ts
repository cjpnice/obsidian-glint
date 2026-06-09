import { App, FuzzySuggestModal, PluginSettingTab, Setting, TFolder, normalizePath } from "obsidian";

import type GlintCaptureOrganizerPlugin from "./main";
import type { ProviderType } from "./types";
import { DEFAULT_SETTINGS } from "./defaults";
import { normalizeConfiguredPath } from "./paths";

export class GlintSettingTab extends PluginSettingTab {
  plugin: GlintCaptureOrganizerPlugin;

  constructor(app: App, plugin: GlintCaptureOrganizerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createDiv({
      cls: "glint-setting-muted",
      text: this.plugin.t("settings.desc")
    });
    this.renderUsageGuide(containerEl);
    this.renderCoreSettings(containerEl);
    this.renderProviderSettings(containerEl);
    this.renderActions(containerEl);
  }

  private renderCoreSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(this.plugin.t("settings.language"))
      .setDesc(this.plugin.t("settings.languageDesc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("zh", this.plugin.t("settings.languageZh"))
          .addOption("en", this.plugin.t("settings.languageEn"))
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value === "en" ? "en" : "zh";
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.inboxFolder"))
      .setDesc(this.plugin.t("settings.inboxFolderDesc"))
      .addText((text) =>
        text.setValue(this.plugin.settings.inboxFolder).onChange(async (value) => {
          this.plugin.settings.inboxFolder = normalizeConfiguredPath(value || DEFAULT_SETTINGS.inboxFolder);
          await this.plugin.saveSettings();
          await this.plugin.ensureConfiguredFolders();
        })
      )
      .addButton((button) =>
        button.setButtonText(this.plugin.t("settings.chooseFolder")).onClick(() => {
          this.openFolderChooser((path) => {
            this.plugin.settings.inboxFolder = normalizePath(path || DEFAULT_SETTINGS.inboxFolder);
          });
        })
      )
      .addButton((button) =>
        button.setButtonText(this.plugin.t("settings.useShortcutsFolder")).onClick(async () => {
          this.plugin.settings.inboxFolder = DEFAULT_SETTINGS.inboxFolder;
          await this.plugin.saveSettings();
          await this.plugin.ensureConfiguredFolders();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.outputFolder"))
      .setDesc(this.plugin.t("settings.outputFolderDesc"))
      .addText((text) =>
        text.setValue(this.plugin.settings.outputFolder).onChange(async (value) => {
          this.plugin.settings.outputFolder = normalizePath(value || DEFAULT_SETTINGS.outputFolder);
          await this.plugin.saveSettings();
          await this.plugin.ensureConfiguredFolders();
        })
      )
      .addButton((button) =>
        button.setButtonText(this.plugin.t("settings.chooseFolder")).onClick(() => {
          this.openFolderChooser((path) => {
            this.plugin.settings.outputFolder = normalizePath(path || DEFAULT_SETTINGS.outputFolder);
          });
        })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.iosShortcut"))
      .setDesc(this.plugin.t("settings.iosShortcutDesc"))
      .addButton((button) =>
        button.setButtonText(this.plugin.t("settings.copyShortcutLink")).onClick(() => {
          void this.plugin.copyIOSShortcutShareLink();
        })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.autoProcessInbox"))
      .setDesc(
        `${this.plugin.t("settings.autoProcessInboxDesc")} ${this.plugin.t("settings.autoProcessStatus", {
          status: this.plugin.settings.autoProcessInbox ? this.plugin.t("view.enabled") : this.plugin.t("view.disabled")
        })}`
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoProcessInbox).onChange(async (value) => {
          this.plugin.settings.autoProcessInbox = value;
          await this.plugin.saveSettings();
          this.plugin.applyAutoProcessSetting();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settings.fetchUrlContent"))
      .setDesc(this.plugin.t("settings.fetchUrlContentDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.fetchUrlContent).onChange(async (value) => {
          this.plugin.settings.fetchUrlContent = value;
          await this.plugin.saveSettings();
        })
      );
  }

  private renderProviderSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(this.plugin.t("settings.provider"))
      .setDesc(this.plugin.t("settings.providerDesc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("local", this.plugin.t("settings.providerLocal"))
          .addOption("ollama", this.plugin.t("settings.providerOllama"))
          .addOption("openai-compatible", this.plugin.t("settings.providerOpenAI"))
          .setValue(this.plugin.settings.providerType)
          .onChange(async (value) => {
            this.plugin.settings.providerType = value as ProviderType;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.providerType !== "local") {
      new Setting(containerEl)
        .setName(this.plugin.t("settings.endpoint"))
        .addText((text) =>
          text.setValue(this.plugin.settings.endpointUrl).onChange(async (value) => {
            this.plugin.settings.endpointUrl = value.trim();
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName(this.plugin.t("settings.model"))
        .addText((text) =>
          text.setValue(this.plugin.settings.modelName).onChange(async (value) => {
            this.plugin.settings.modelName = value.trim();
            await this.plugin.saveSettings();
          })
        );
    }

    if (this.plugin.settings.providerType === "openai-compatible") {
      new Setting(containerEl)
        .setName(this.plugin.t("settings.apiKey"))
        .setDesc(this.plugin.t("settings.apiKeyDesc"))
        .addText((text) => {
          text.inputEl.type = "password";
          text.setValue(this.plugin.settings.apiKey).onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          });
        });
    }

    new Setting(containerEl)
      .setName(this.plugin.t("settings.testProvider"))
      .setDesc(this.plugin.t("settings.testProviderDesc"))
      .addButton((button) =>
        button.setButtonText(this.plugin.t("settings.test")).onClick(async () => {
          button.buttonEl.disabled = true;
          button.setButtonText(this.plugin.t("settings.testing"));
          try {
            await this.plugin.saveSettings();
            await this.plugin.testProvider();
          } finally {
            button.setButtonText(this.plugin.t("settings.test"));
            button.buttonEl.disabled = false;
          }
        })
      );
  }

  private renderActions(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(this.plugin.t("settings.processInbox"))
      .addButton((button) =>
        button
          .setButtonText(this.plugin.t("settings.process"))
          .setCta()
          .onClick(() => {
            void this.plugin.processInbox();
          })
      );
  }

  private renderUsageGuide(containerEl: HTMLElement): void {
    const wrapper = containerEl.createDiv({
      cls: "glint-inbox-status glint-inbox-ok"
    });
    wrapper.createEl("strong", { text: this.plugin.t("settings.usageGuideTitle") });
    const list = wrapper.createEl("ol");
    list.createEl("li", { text: this.plugin.t("settings.usageGuideCopyShortcut") });
    list.createEl("li", { text: this.plugin.t("settings.usageGuideInbox") });
    list.createEl("li", { text: this.plugin.t("settings.usageGuideAuto") });
    list.createEl("li", { text: this.plugin.t("settings.usageGuideStatus") });
    wrapper.createEl("div", { cls: "glint-guide-note", text: this.plugin.t("settings.processedFieldHint") });
  }

  private openFolderChooser(assignPath: (path: string) => void): void {
    void this.plugin.ensureConfiguredFolders().then(() => {
      new FolderSuggestModal(this.app, this.plugin, async (path) => {
        assignPath(path);
        await this.plugin.saveSettings();
        await this.plugin.ensureConfiguredFolders();
        this.display();
      }).open();
    });
  }
}

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  plugin: GlintCaptureOrganizerPlugin;
  onChooseFolder: (path: string) => void | Promise<void>;

  constructor(app: App, plugin: GlintCaptureOrganizerPlugin, onChooseFolder: (path: string) => void | Promise<void>) {
    super(app);
    this.plugin = plugin;
    this.onChooseFolder = onChooseFolder;
    this.setPlaceholder(plugin.t("settings.folderPlaceholder"));
    this.emptyStateText = plugin.t("settings.noFolders");
  }

  getItems(): TFolder[] {
    return this.app.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder && !file.isRoot())
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  getItemText(folder: TFolder): string {
    return folder.path;
  }

  onChooseItem(folder: TFolder): void {
    void this.onChooseFolder(folder.path);
  }
}
