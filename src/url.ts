import type { AppLanguage, FetchedURLContent, GlintCapture } from "./types";

export function shouldFetchURLContent(capture: GlintCapture): boolean {
  if (!capture.originalURL || !looksLikeUrl(capture.originalURL)) return false;
  const body = capturedBodyText(capture);
  const meaningful = stripURLOnlyText(body, capture.originalURL);
  return meaningful.length < 120;
}

export function capturedBodyText(capture: GlintCapture): string {
  return [capture.text, capture.note].filter(Boolean).join("\n\n").trim();
}

export function captureText(capture: GlintCapture): string {
  const body = capturedBodyText(capture);
  const note = capture.note && stripURLOnlyText(capture.note, capture.originalURL ?? "").length ? capture.note : undefined;
  const text = capture.text && stripURLOnlyText(capture.text, capture.originalURL ?? "").length ? capture.text : undefined;
  return [text, note, capture.originalURL ? `URL: ${capture.originalURL}` : undefined].filter(Boolean).join("\n\n") || body;
}

export function stripURLOnlyText(value: string, knownURL: string): string {
  let text = value.trim();
  if (knownURL) text = text.split(knownURL).join(" ");
  text = text
    .replace(/^[-*]\s*/gm, "")
    .replace(/^URL\s*[:：]\s*/gim, "")
    .replace(/https?:\/\/[^\s<>"')\]]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

export function firstHttpUrl(value?: string): string | undefined {
  const match = value?.match(/https?:\/\/[^\s<>"')\]]+/i);
  return match?.[0].replace(/[),.;，。；]+$/g, "");
}

export function extractReadableTextFromHTML(raw: string): FetchedURLContent | null {
  const input = raw.trim();
  if (!input) return null;
  if (!looksLikeHTML(input)) {
    return { text: normalizeReadableText(input).slice(0, 80_000) };
  }

  const fromDOM = extractReadableTextWithDOM(input);
  if (fromDOM?.text && fromDOM.text.length >= 80) return fromDOM;

  const title = fromDOM?.title || extractTitleFromHTML(input);
  const text = normalizeReadableText(
    decodeHTMLEntities(
      input
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<\/(p|div|section|article|li|h[1-6]|br)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    )
  );
  if (!text) return null;
  return { title, text: text.slice(0, 80_000) };
}

export function assessURLContentQuality(content: FetchedURLContent, language: AppLanguage): string | undefined {
  const text = normalizeReadableText(content.text);
  const lower = text.toLowerCase();
  const blockedPattern =
    /captcha|cloudflare|access denied|forbidden|enable javascript|sign in|log in|login required|verify you are human|请登录|登录后|验证码|访问受限|安全验证|人机验证/;
  if (blockedPattern.test(lower)) {
    return language === "zh" ? "URL 正文疑似登录页、反爬页或访问受限页面。" : "Fetched URL content looks like a login, anti-bot, or access-restricted page.";
  }
  if (text.length < 240) {
    return language === "zh" ? "URL 正文内容过短，可能是登录页、反爬页或空页面。" : "Fetched URL content is too short and may be a login, anti-bot, or empty page.";
  }
  return undefined;
}

function extractReadableTextWithDOM(html: string): FetchedURLContent | null {
  if (typeof DOMParser === "undefined") return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const title = extractTitleFromDocument(doc) || extractTitleFromHTML(html);
  doc.querySelectorAll("script, style, noscript, svg, iframe, canvas, form, nav, footer").forEach((node) => node.remove());

  const preferred = doc.querySelector("#js_content");
  const candidates = [
    preferred,
    doc.querySelector("article"),
    doc.querySelector("main"),
    doc.querySelector("[role='main']"),
    doc.querySelector(".article"),
    doc.querySelector(".post-content"),
    doc.querySelector(".entry-content"),
    doc.body
  ].filter((node): node is Element => Boolean(node));

  let best = "";
  for (const candidate of candidates) {
    const text = normalizeReadableText(readableTextFromElement(candidate));
    if (text.length > best.length) best = text;
    if (candidate === preferred && text.length >= 200) break;
  }

  if (!best) return null;
  return { title, text: best.slice(0, 80_000) };
}

function readableTextFromElement(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  clone.querySelectorAll("p, div, section, article, li, h1, h2, h3, h4, h5, h6, blockquote").forEach((node) => {
    node.append(document.createTextNode("\n"));
  });
  return clone.textContent ?? "";
}

function extractTitleFromDocument(doc: Document): string | undefined {
  return (
    metaContent(doc, "og:title") ||
    metaContent(doc, "twitter:title") ||
    metaContent(doc, "title") ||
    doc.querySelector("#activity-name")?.textContent?.trim() ||
    doc.title.trim() ||
    undefined
  );
}

function metaContent(doc: Document, name: string): string | undefined {
  return doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute("content")?.trim() || undefined;
}

function extractTitleFromHTML(html: string): string | undefined {
  const scriptTitle = html.match(/var\s+msg_title\s*=\s*['"]([\s\S]*?)['"]\s*;/)?.[1];
  const title = scriptTitle || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? normalizeReadableText(decodeHTMLEntities(title.replace(/\\x26/g, "&"))) : undefined;
}

function looksLikeHTML(value: string): boolean {
  return /<!doctype\s+html|<html[\s>]|<body[\s>]|<article[\s>]|<div[\s>]/i.test(value);
}

function normalizeReadableText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHTMLEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (match, code: string) => decodeCodePoint(Number(code), match))
    .replace(/&#x([0-9a-f]+);/gi, (match, code: string) => decodeCodePoint(parseInt(code, 16), match))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function decodeCodePoint(codePoint: number, fallback: string): string {
  try {
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : fallback;
  } catch {
    return fallback;
  }
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}
