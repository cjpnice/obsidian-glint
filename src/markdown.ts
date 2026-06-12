import type { AnalysisResult, AppLanguage, GlintCapture } from "./types";
import { translate } from "./i18n";
import { defaultCategory } from "./utils";
import { localStructuredNote, sanitizeAnalysisNote } from "./analysis";

export interface MarkdownOptions {
  includeSummaryCallout: boolean;
  includeSourceSection: boolean;
  includeOriginalExcerpt: boolean;
  includeUrlMetadata: boolean;
}

export function markdownForCapture(
  capture: GlintCapture,
  analysis: AnalysisResult,
  language: AppLanguage,
  options: MarkdownOptions
): string {
  const summary = analysis.summary || translate(language, "markdown.noSummary");
  const keyPoints = analysis.keyPoints.length ? analysis.keyPoints : [translate(language, "markdown.noKeyPoints")];
  const note = sanitizeAnalysisNote(analysis.note ?? "") || localStructuredNote(summary, keyPoints, language);
  const frontmatter = frontmatterForCapture(capture, analysis, summary, language).join("\n");
  const sourceList = [
    capture.originalURL ? `- ${translate(language, "markdown.url")}: ${capture.originalURL}` : `- ${translate(language, "markdown.url")}: -`,
    options.includeUrlMetadata && capture.urlTitle ? `- ${translate(language, "markdown.sourceTitle")}: ${capture.urlTitle}` : undefined,
    options.includeUrlMetadata && capture.urlSiteName ? `- ${translate(language, "markdown.siteName")}: ${capture.urlSiteName}` : undefined,
    options.includeUrlMetadata && capture.urlAuthor ? `- ${translate(language, "markdown.author")}: ${capture.urlAuthor}` : undefined,
    options.includeUrlMetadata && capture.urlPublishedAt ? `- ${translate(language, "markdown.published")}: ${capture.urlPublishedAt}` : undefined,
    `- ${translate(language, "markdown.captured")}: ${capture.createdAt ?? ""}`,
    `- ${translate(language, "markdown.captureMethod")}: ${capture.captureMethod ?? "-"}`,
    `- ${translate(language, "markdown.generated")}: ${analysis.providerName}${analysis.modelName ? ` / ${analysis.modelName}` : ""}`,
    analysis.fallbackWarning ? `- ${translate(language, "markdown.warning")}: ${analysis.fallbackWarning}` : undefined
  ].filter(Boolean).join("\n");
  const lines = [
    frontmatter,
    "",
    `# ${analysis.title}`,
    ...(options.includeSummaryCallout
      ? [
          "",
          `> [!abstract] ${translate(language, "markdown.summary")}`,
          ...quoteBlock(summary)
        ]
      : []),
    "",
    `## ${translate(language, "markdown.keyPoints")}`,
    ...keyPoints.map((point) => `- ${point}`),
    "",
    `## ${translate(language, "markdown.note")}`,
    note,
    ...(options.includeOriginalExcerpt ? originalExcerptSection(capture, language) : []),
    ...(options.includeSourceSection
      ? [
          "",
          `## ${translate(language, "markdown.source")}`,
          sourceList
        ]
      : [])
  ];
  return `${lines.join("\n")}\n`;
}

function frontmatterForCapture(capture: GlintCapture, analysis: AnalysisResult, summary: string, language: AppLanguage): string[] {
  return [
    "---",
    `title: ${yamlString(analysis.title)}`,
    `summary: ${yamlString(summary)}`,
    `category: ${yamlString(analysis.category || defaultCategory(language))}`,
    yamlList("tags", analysis.tags),
    yamlList("entities", analysis.entities),
    capture.originalURL ? `source: ${yamlString(capture.originalURL)}` : undefined,
    capture.urlTitle ? `source_title: ${yamlString(capture.urlTitle)}` : undefined,
    capture.urlSiteName ? `source_site: ${yamlString(capture.urlSiteName)}` : undefined,
    capture.urlAuthor ? `source_author: ${yamlString(capture.urlAuthor)}` : undefined,
    capture.urlPublishedAt ? `source_published: ${yamlString(capture.urlPublishedAt)}` : undefined,
    capture.contentHash ? `content_hash: ${yamlString(capture.contentHash)}` : undefined,
    `capture_id: ${yamlString(capture.id ?? "")}`,
    `captured: ${yamlString(capture.createdAt ?? new Date().toISOString())}`,
    `provider: ${yamlString(analysis.providerName)}`,
    analysis.modelName ? `model: ${yamlString(analysis.modelName)}` : undefined,
    analysis.fallbackWarning ? `analysis_warning: ${yamlString(analysis.fallbackWarning)}` : undefined,
    "---"
  ].filter((line): line is string => typeof line === "string");
}

function originalExcerptSection(capture: GlintCapture, language: AppLanguage): string[] {
  const sourceText = [capture.text, capture.note].filter(Boolean).join("\n\n").trim();
  if (!sourceText) return [];
  return [
    "",
    `## ${translate(language, "markdown.originalExcerpt")}`,
    sourceText.slice(0, 2000)
  ];
}

function quoteBlock(value: string): string[] {
  const lines = value.split(/\r?\n/);
  return lines.length ? lines.map((line) => (line.trim() ? `> ${line}` : ">")) : [">"];
}

function yamlList(key: string, values: string[]): string {
  if (!values.length) return `${key}: []`;
  return [`${key}:`, ...values.map((value) => `  - ${yamlString(value)}`)].join("\n");
}

function yamlString(value: string): string {
  return JSON.stringify(value ?? "");
}
