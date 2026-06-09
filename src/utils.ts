import type { AppLanguage } from "./types";
import { translate } from "./i18n";

export function formatDateTime(value: string | number, language: AppLanguage): string {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(language === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function safeFilename(value: string, language: AppLanguage = "en"): string {
  const cleaned = (value || defaultTitle(language)).replace(/[][\\/:*?"<>|#^]+/g, "-").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 90) || defaultTitle(language);
}

export function firstLineTitle(text: string, language: AppLanguage = "en"): string {
  return text.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 80) || defaultTitle(language);
}

export function defaultTitle(language: AppLanguage): string {
  return translate(language, "default.untitled");
}

export function defaultCategory(language: AppLanguage): string {
  return translate(language, "default.uncategorized");
}

export function usableTitle(title?: string): boolean {
  if (!title?.trim()) return false;
  return title.length <= 90 && !looksLikeUrl(title);
}

export function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[,，;；\n]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
