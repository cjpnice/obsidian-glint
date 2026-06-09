import type { AnalysisResult, AppLanguage } from "./types";
import { defaultCategory } from "./utils";

export function coalesceLabels(labels: string[], existing: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const label of labels) {
    const value = coalesceLabel(label, existing) ?? label.trim();
    const key = taxonomyKey(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

export function taxonomyReferenceText(captureTitle: string | undefined, captureURL: string | undefined, text: string, analysis: AnalysisResult): string {
  return [captureTitle, captureURL, analysis.summary, analysis.keyPoints.join("\n"), analysis.note, text].filter(Boolean).join("\n");
}

export function chooseCategoryLabel(proposed: string, text: string, existing: string[], language: AppLanguage): string {
  const matched = coalesceLabel(proposed, existing) ?? bestExistingLabelForText(text, existing);
  if (matched) return matched;
  const trimmed = proposed.trim();
  return trimmed || defaultCategory(language);
}

export function chooseTagLabels(proposed: string[], text: string, existing: string[], limit: number): string[] {
  const seen = new Set<string>();
  const reused: string[] = [];

  for (const label of proposed) {
    const matched = coalesceLabel(label, existing);
    if (!matched) continue;
    const key = taxonomyKey(matched);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    reused.push(matched);
    if (reused.length >= limit) return reused;
  }

  for (const label of existing) {
    if (!labelMatchesText(label, text)) continue;
    const key = taxonomyKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    reused.push(label);
    if (reused.length >= limit) return reused;
  }

  if (reused.length > 0) return reused;
  return coalesceLabels(proposed, existing, limit);
}

export function bestExistingLabelForText(text: string, existing: string[]): string | null {
  let best: { label: string; score: number } | null = null;
  for (const label of existing) {
    const score = labelTextScore(label, text);
    if (score > (best?.score ?? 0)) best = { label, score };
  }
  return best && best.score >= 1 ? best.label : null;
}

export function labelMatchesText(label: string, text: string): boolean {
  return labelTextScore(label, text) >= 1;
}

export function rankedLabels(labels: string[], limit: number): string[] {
  const stats = new Map<string, { label: string; count: number; first: number }>();
  labels.forEach((label, index) => {
    const value = label.trim();
    const key = taxonomyKey(value);
    if (!value || !key) return;
    const current = stats.get(key);
    if (current) current.count += 1;
    else stats.set(key, { label: value, count: 1, first: index });
  });
  return [...stats.values()]
    .sort((left, right) => right.count - left.count || left.first - right.first)
    .slice(0, limit)
    .map((entry) => entry.label);
}

export function taxonomyKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "");
}

function labelTextScore(label: string, text: string): number {
  const labelKey = taxonomyKey(label);
  const textKey = taxonomyKey(text);
  if (!labelKey || !textKey) return 0;
  if (labelKey.length >= 2 && textKey.includes(labelKey)) return 3;

  let score = 0;
  for (const token of taxonomyTokens(label)) {
    const tokenKey = taxonomyKey(token);
    if (tokenKey.length >= 2 && textKey.includes(tokenKey)) score += 1;
  }
  return score;
}

function coalesceLabel(label: string, existing: string[]): string | null {
  const key = taxonomyKey(label);
  if (!key) return null;
  for (const candidate of existing) {
    if (taxonomyKey(candidate) === key) return candidate;
  }
  for (const candidate of existing) {
    const candidateKey = taxonomyKey(candidate);
    if (key.length >= 3 && candidateKey.length >= 3 && (key.includes(candidateKey) || candidateKey.includes(key))) {
      return candidate;
    }
  }
  const tokens = taxonomyTokens(label);
  let best: { label: string; score: number } | null = null;
  for (const candidate of existing) {
    const score = jaccard(tokens, taxonomyTokens(candidate));
    if (score >= 0.62 && score > (best?.score ?? 0)) best = { label: candidate, score };
  }
  return best?.label ?? null;
}

function taxonomyTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/u)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2)
  );
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((value) => right.has(value)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}
