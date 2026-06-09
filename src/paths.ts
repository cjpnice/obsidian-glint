import { homedir } from "os";
import * as path from "path";

import { normalizePath } from "obsidian";

export function defaultShortcutsContainerPath(): string {
  return path.join(homedir(), "Library/Mobile Documents/iCloud~is~workflow~my~workflows/Documents");
}

export function defaultShortcutsRootPath(): string {
  return path.join(defaultShortcutsContainerPath(), "Glint");
}

export function legacyShortcutsInboxPath(): string {
  return path.join(defaultShortcutsContainerPath(), "Shortcuts/Glint/Inbox");
}

export function defaultShortcutsInboxPath(): string {
  return path.join(defaultShortcutsRootPath(), "Inbox");
}

export function isLegacyShortcutsInboxPath(value: string): boolean {
  return path.normalize(expandHome(value)) === path.normalize(legacyShortcutsInboxPath());
}

export function normalizeConfiguredPath(value: string): string {
  const trimmed = value.trim();
  return isExternalPath(trimmed) ? expandHome(trimmed) : normalizePath(trimmed);
}

export function isExternalPath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("~/") || /^[A-Za-z]:[\\/]/.test(value);
}

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}
