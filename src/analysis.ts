import type { AnalysisResult, AppLanguage, GlintCapture, TaxonomyContext } from "./types";
import { translate } from "./i18n";
import { chooseCategoryLabel, chooseTagLabels } from "./taxonomy";
import { defaultCategory, firstLineTitle, stringArray, stringValue, usableTitle } from "./utils";

export function systemPrompt(language: AppLanguage): string {
  if (language === "zh") {
    return `你负责为 Obsidian Vault 整理个人知识。
只返回合法 JSON，字段如下：
title: string
summary: string            // 2-4 句，高密度概括
keyPoints: string[]        // 3-7 条，每条是独立完整观点
note: string               // 结构化 Markdown 正文，不含一级标题，不要复述原文，使用 2-4 个三级小标题或短列表
tags: string[]
category: string
entities: string[]

要求：
- 除非原文明显是英文内容，否则 title、summary、keyPoints、note、tags、category、entities 都使用中文。
- 分类必须先从“已有分类”中选择；只在所有已有分类都明显不合适时才创建新分类。
- 标签必须优先从“已有标签”中选择，复用已有标签的精确写法；只在没有任何相近已有标签时才创建少量新标签。
- tags 控制在 3-8 个，不要为了覆盖关键词而制造大量新标签。
- 不要输出原文全文。
- note 要像整理后的知识卡片，避免空话、营销腔和大段引用。`;
  }

  return `You organize personal knowledge for an Obsidian vault.
Return only valid JSON with:
title: string
summary: string            // 2-4 dense sentences
keyPoints: string[]        // 3-7 self-contained points
note: string               // structured Markdown body, no H1 title, no raw source dump, use 2-4 H3 subsections or short lists
tags: string[]
category: string
entities: string[]

Requirements:
- Choose category from the existing categories first; create a new category only when none of them clearly fits.
- Choose tags from the existing tags first and reuse exact spelling; create only a few new tags when no existing tags are close.
- Keep tags to 3-8 items. Do not create many new labels just to cover keywords.
- Do not include the full original text.
- Preserve the source language when possible.
- Make note read like a polished knowledge card, not a transcript or generic summary.`;
}

export function userPrompt(capture: GlintCapture, text: string, taxonomy: TaxonomyContext, language: AppLanguage): string {
  if (language === "zh") {
    return `标题：${capture.title ?? ""}
URL：${capture.originalURL ?? ""}

已有分类：${taxonomy.categories.length ? taxonomy.categories.join(" | ") : "（无）"}
已有标签：${taxonomy.tags.length ? taxonomy.tags.join(" | ") : "（无）"}

内容：
${text.slice(0, 40_000)}`;
  }

  return `Title: ${capture.title ?? ""}
URL: ${capture.originalURL ?? ""}

Existing categories: ${taxonomy.categories.length ? taxonomy.categories.join(" | ") : "(none)"}
Existing tags: ${taxonomy.tags.length ? taxonomy.tags.join(" | ") : "(none)"}

Content:
${text.slice(0, 40_000)}`;
}

export function localAnalyze(capture: GlintCapture, text: string, taxonomy: TaxonomyContext, language: AppLanguage): AnalysisResult {
  const sentences = splitSentences(text);
  const summary = sentences.slice(0, 3).join(" ") || capture.title || firstLineTitle(text, language);
  const rawTags = keywords(`${capture.title ?? ""} ${text}`).slice(0, 10);
  const rawCategory = categoryFromText(rawTags, text, language);
  const keyPoints = sentences.slice(0, 5).length ? sentences.slice(0, 5) : [summary];
  const taxonomyText = `${capture.title ?? ""}\n${summary}\n${keyPoints.join("\n")}\n${text}`;
  const tags = chooseTagLabels(rawTags, taxonomyText, taxonomy.tags, 8);
  return {
    title: usableTitle(capture.title) ? capture.title!.trim() : firstLineTitle(summary, language),
    summary,
    keyPoints,
    note: localStructuredNote(summary, keyPoints, language),
    tags,
    category: chooseCategoryLabel(rawCategory, taxonomyText, taxonomy.categories, language),
    entities: tags.slice(0, 12),
    providerName: "Local"
  };
}

export function parseAnalysisJSON(
  content: string,
  providerName: string,
  modelName: string | undefined,
  language: AppLanguage
): AnalysisResult | null {
  try {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    const json = JSON.parse(start >= 0 && end >= start ? content.slice(start, end + 1) : content);
    return {
      title: stringValue(json.title || json.generatedTitle),
      summary: stringValue(json.summary),
      keyPoints: stringArray(json.keyPoints || json.key_points || json.keypoints),
      note: sanitizeAnalysisNote(stringValue(json.note || json.body || json.markdown || json.markdownBody)),
      tags: stringArray(json.tags),
      category: stringValue(json.category) || defaultCategory(language),
      entities: stringArray(json.entities || json.namedEntities || json.named_entities),
      providerName,
      modelName
    };
  } catch {
    return null;
  }
}

export function localStructuredNote(summary: string, keyPoints: string[], language: AppLanguage): string {
  const overview = language === "zh" ? "### 内容概览" : "### Overview";
  const focus = language === "zh" ? "### 重点整理" : "### Organized points";
  return [
    overview,
    summary,
    "",
    focus,
    ...keyPoints.slice(0, 5).map((point) => `- ${point}`)
  ].join("\n");
}

export function sanitizeAnalysisNote(value: string): string {
  return value
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^#\s+.+\n+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function openAIEndpoint(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "https://api.openai.com/v1/chat/completions";
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  const base = trimmed.replace(/\/+$/, "");
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

export function assertProviderResponseOK(status: number, content: unknown, language: AppLanguage): void {
  if (status < 200 || status >= 300) {
    throw new Error(translate(language, "error.httpStatus", { status }));
  }
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(translate(language, "error.emptyProviderResponse"));
  }
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。！？])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 24);
}

function keywords(text: string): string[] {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "your",
    "have",
    "about",
    "into",
    "https",
    "http",
    "www",
    "com"
  ]);
  const matches = text.toLowerCase().match(/[a-z0-9][a-z0-9+.#-]{2,}|[\u4e00-\u9fff]{2,}/gu) ?? [];
  const counts = new Map<string, number>();
  for (const match of matches) {
    if (stop.has(match) || match.length > 32) continue;
    counts.set(match, (counts.get(match) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([word]) => word);
}

function categoryFromText(tags: string[], text: string, language: AppLanguage): string {
  const lower = `${tags.join(" ")} ${text}`.toLowerCase();
  const buckets: Array<[string, string[]]> = [
    [language === "zh" ? "AI" : "AI", ["ai", "llm", "model", "prompt", "agent", "openai", "claude", "ollama", "模型", "智能体"]],
    [language === "zh" ? "工程" : "Engineering", ["code", "api", "server", "frontend", "backend", "github", "swift", "typescript", "工程", "开发"]],
    [language === "zh" ? "产品" : "Product", ["product", "design", "ux", "research", "用户", "体验", "产品", "设计"]],
    [language === "zh" ? "商业" : "Business", ["market", "business", "growth", "strategy", "revenue", "商业", "市场", "增长"]],
    [language === "zh" ? "研究" : "Research", ["paper", "study", "research", "dataset", "论文", "研究", "实验"]],
    [language === "zh" ? "风险" : "Risk", ["risk", "security", "privacy", "policy", "legal", "风险", "安全", "隐私", "政策"]]
  ];
  return buckets.find(([, words]) => words.some((word) => lower.includes(word)))?.[0] ?? defaultCategory(language);
}
