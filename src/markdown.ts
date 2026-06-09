import type { AnalysisResult, AppLanguage, GlintCapture } from "./types";
import { translate } from "./i18n";
import { defaultCategory } from "./utils";
import { localStructuredNote, sanitizeAnalysisNote } from "./analysis";

export function markdownForCapture(
  capture: GlintCapture,
  analysis: AnalysisResult,
  language: AppLanguage
): string {
  const summary = analysis.summary || translate(language, "markdown.noSummary");
  const keyPoints = analysis.keyPoints.length ? analysis.keyPoints : [translate(language, "markdown.noKeyPoints")];
  const note = sanitizeAnalysisNote(analysis.note ?? "") || localStructuredNote(summary, keyPoints, language);
  const frontmatter = frontmatterForCapture(capture, analysis, summary, language).join("\n");
  const sourceList = [
    capture.originalURL ? `- ${translate(language, "markdown.url")}: ${capture.originalURL}` : `- ${translate(language, "markdown.url")}: -`,
    `- ${translate(language, "markdown.captured")}: ${capture.createdAt ?? ""}`,
    `- ${translate(language, "markdown.captureMethod")}: ${capture.captureMethod ?? "-"}`,
    `- ${translate(language, "markdown.generated")}: ${analysis.providerName}${analysis.modelName ? ` / ${analysis.modelName}` : ""}`
  ].join("\n");
  const lines = [
    frontmatter,
    "",
    `# ${analysis.title}`,
    "",
    `> [!abstract] ${translate(language, "markdown.summary")}`,
    ...quoteBlock(summary),
    "",
    `## ${translate(language, "markdown.keyPoints")}`,
    ...keyPoints.map((point) => `- ${point}`),
    "",
    `## ${translate(language, "markdown.note")}`,
    note,
    "",
    `## ${translate(language, "markdown.source")}`,
    sourceList
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
    `capture_id: ${yamlString(capture.id ?? "")}`,
    `captured: ${yamlString(capture.createdAt ?? new Date().toISOString())}`,
    `provider: ${yamlString(analysis.providerName)}`,
    analysis.modelName ? `model: ${yamlString(analysis.modelName)}` : undefined,
    "---"
  ].filter((line): line is string => typeof line === "string");
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
