import type { GlintSettings } from "./types";
import { defaultShortcutsInboxPath } from "./paths";

export const DEFAULT_SETTINGS: GlintSettings = {
  language: "zh",
  inboxFolder: defaultShortcutsInboxPath(),
  outputFolder: "Glint/Notes",
  autoProcessInbox: true,
  fetchUrlContent: true,
  providerType: "local",
  endpointUrl: "http://localhost:11434/api/chat",
  modelName: "llama3.1",
  apiKey: "",
  temperature: 0.2,
  maxExistingCategories: 40,
  maxExistingTags: 120
};

export const LEGACY_DEFAULT_FOLDERS = {
  inboxFolder: "Glint Inbox",
  nestedInboxFolder: "Glint/Inbox",
  outputFolder: "Glint Notes"
};
