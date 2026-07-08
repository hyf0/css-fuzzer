import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";

export interface CsswgSpecEntry {
  readonly slug: string;
  readonly title: string;
  readonly url: string;
  readonly date?: string;
}

export interface CsswgExample {
  readonly slug: string;
  readonly source: string;
}

export interface CsswgSpecDownloadFailure {
  readonly slug: string;
  readonly url: string;
  readonly message: string;
}

export interface CsswgExampleCount {
  readonly slug: string;
  readonly extractedExamples: number;
}

export interface FetchCsswgOptions {
  readonly outDir: string;
  readonly downloadSpecs: boolean;
  readonly slugs?: readonly string[];
  readonly maxExamplesPerSpec?: number;
  readonly allowFetchFailures?: boolean;
}

const csswgIndexUrl = "https://drafts.csswg.org/";

const parserRelevantSpecPrefixes = [
  "animation-triggers",
  "compositing",
  "css",
  "fill-stroke",
  "filter-effects",
  "mediaqueries",
  "motion",
  "scroll",
  "selectors",
  "web-animations-css-integration",
] as const;

export const requiredModernSpecSlugs = [
  "css-syntax-3",
  "selectors-4",
  "selectors-5",
  "css-nesting-1",
  "css-cascade-5",
  "css-cascade-6",
  "css-conditional-5",
  "mediaqueries-5",
  "css-contain-3",
  "css-values-4",
  "css-values-5",
  "css-color-4",
  "css-color-5",
  "css-pseudo-4",
  "css-anchor-position-1",
  "scroll-animations-1",
  "css-view-transitions-2",
  "css-grid-3",
  "css-animations-2",
  "css-transitions-2",
  "css-page-3",
  "css-counter-styles-3",
  "css-fonts-4",
  "css-fonts-5",
  "css-variables-2",
  "css-properties-values-api-1",
] as const;

const externalSpecUrls = {
  "css-properties-values-api-1": "https://drafts.css-houdini.org/css-properties-values-api-1/",
} as const;

export async function fetchCsswgSpecs(options: FetchCsswgOptions): Promise<{
  specs: readonly CsswgSpecEntry[];
  examples: readonly CsswgExample[];
  selectedSlugs: readonly string[];
  downloadedSlugs: readonly string[];
  failedSpecs: readonly CsswgSpecDownloadFailure[];
  exampleCountsBySpec: readonly CsswgExampleCount[];
}> {
  await mkdir(options.outDir, { recursive: true });
  const fetchedAt = new Date().toISOString();
  const indexHtml = await fetchText(csswgIndexUrl);
  const specs = parseCsswgIndex(indexHtml);
  await writeFile(
    path.join(options.outDir, "csswg-index.json"),
    `${JSON.stringify({ fetchedAt, specs }, null, 2)}\n`,
    "utf8",
  );

  const examples: CsswgExample[] = [];
  const selectedSlugs: string[] = [];
  const downloadedSlugs: string[] = [];
  const failedSpecs: CsswgSpecDownloadFailure[] = [];
  const exampleCountsBySpec: CsswgExampleCount[] = [];
  if (options.downloadSpecs) {
    const rawDir = path.join(options.outDir, "raw");
    await mkdir(rawDir, { recursive: true });
    selectedSlugs.push(...resolveSelectedSpecSlugs(specs, options.slugs));
    const bySlug = new Map(specs.map((spec) => [spec.slug, spec]));
    for (const slug of selectedSlugs) {
      const spec = bySlug.get(slug) ?? {
        slug,
        title: slug,
        url:
          externalSpecUrls[slug as keyof typeof externalSpecUrls] ??
          new URL(`${slug}/`, csswgIndexUrl).href,
      };
      const html = await fetchTextOrFailure(spec.url);
      if (typeof html !== "string") {
        failedSpecs.push({ slug, url: spec.url, message: html.message });
        continue;
      }
      downloadedSlugs.push(slug);
      await writeFile(path.join(rawDir, `${slug}.html`), html, "utf8");
      const specExamples =
        options.maxExamplesPerSpec === undefined
          ? extractExamples(slug, html)
          : extractExamples(slug, html, { maxExamples: options.maxExamplesPerSpec });
      exampleCountsBySpec.push({ slug, extractedExamples: specExamples.length });
      examples.push(...specExamples);
    }
    await writeFile(
      path.join(options.outDir, "examples.json"),
      `${JSON.stringify(
        {
          fetchedAt,
          indexUrl: csswgIndexUrl,
          selectedSlugs,
          downloadedSlugs,
          failedSpecs,
          exampleCountsBySpec,
          examples,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    if (failedSpecs.length > 0 && options.allowFetchFailures !== true) {
      throw new Error(
        `Failed to download ${failedSpecs.length} selected CSS spec(s): ${failedSpecs.map((spec) => spec.slug).join(", ")}`,
      );
    }
  }

  return { specs, examples, selectedSlugs, downloadedSlugs, failedSpecs, exampleCountsBySpec };
}

export function parseCsswgIndex(html: string): readonly CsswgSpecEntry[] {
  const $ = cheerio.load(html);
  const specs = new Map<string, CsswgSpecEntry>();
  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href");
    if (href === undefined || !href.endsWith("/")) {
      return;
    }
    const slug = href.replace(/^\.\//, "").replace(/\/$/, "");
    if (!isParserRelevantIndexSlug(slug)) {
      return;
    }
    const title = $(element).text().replace(/\s+/g, " ").trim();
    if (title.length === 0 || slug.includes("/")) {
      return;
    }
    const rowText = $(element).parent().text().replace(/\s+/g, " ");
    const date = rowText.match(/\b20\d\d-\d\d-\d\d\b/)?.[0];
    specs.set(slug, {
      slug,
      title,
      url: new URL(`${slug}/`, csswgIndexUrl).href,
      ...(date === undefined ? {} : { date }),
    });
  });
  return [...specs.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

export function resolveSelectedSpecSlugs(
  specs: readonly CsswgSpecEntry[],
  requestedSlugs?: readonly string[],
): readonly string[] {
  if (requestedSlugs !== undefined) {
    if (requestedSlugs.includes("all")) {
      return dedupeStrings([...specs.map((spec) => spec.slug), ...Object.keys(externalSpecUrls)]);
    }
    return dedupeStrings(requestedSlugs);
  }

  return dedupeStrings([
    ...selectLatestCsswgSpecSlugs(specs),
    ...requiredModernSpecSlugs,
    ...Object.keys(externalSpecUrls),
  ]);
}

export function selectLatestCsswgSpecSlugs(specs: readonly CsswgSpecEntry[]): readonly string[] {
  const selected = new Map<string, { readonly slug: string; readonly level: number }>();
  const unlevelled: string[] = [];

  for (const spec of specs) {
    if (isHistoricalSnapshotSlug(spec.slug) || isNonParserTargetSpecSlug(spec.slug)) {
      continue;
    }

    const levelled = parseLevelledSlug(spec.slug);
    if (levelled === undefined) {
      unlevelled.push(spec.slug);
      continue;
    }

    const previous = selected.get(levelled.family);
    if (previous === undefined || levelled.level > previous.level) {
      selected.set(levelled.family, { slug: spec.slug, level: levelled.level });
    }
  }

  return [...unlevelled, ...[...selected.values()].map((entry) => entry.slug)].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function extractExamples(
  slug: string,
  html: string,
  options: { readonly maxExamples?: number } = {},
): readonly CsswgExample[] {
  const $ = cheerio.load(html);
  const examples: CsswgExample[] = [];
  $("pre, xmp, .example").each((_index, element) => {
    if ($(element).closest(".issue").length > 0) {
      return;
    }
    const text = $(element).text().trim();
    if (looksLikeCss(text)) {
      examples.push({ slug, source: text });
    }
  });
  const deduped = dedupeExamples(examples);
  if (options.maxExamples === undefined) {
    return deduped;
  }
  return deduped.slice(0, options.maxExamples);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": "css-fuzzer/0.0.0" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

async function fetchTextOrFailure(url: string): Promise<string | { readonly message: string }> {
  try {
    return await fetchText(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[warn] ${message}\n`);
    return { message };
  }
}

function looksLikeCss(text: string): boolean {
  if (text.length < 4 || text.length > 20_000) {
    return false;
  }
  return /[{}:;]/.test(text) && !/^\s*(<!doctype|<html|function\s|\{[\s"])/i.test(text);
}

function dedupeExamples(examples: readonly CsswgExample[]): readonly CsswgExample[] {
  const seen = new Set<string>();
  const result: CsswgExample[] = [];
  for (const example of examples) {
    const key = `${example.slug}\0${example.source}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(example);
    }
  }
  return result;
}

function dedupeStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function isHistoricalSnapshotSlug(slug: string): boolean {
  return (
    /^css-\d{4}$/.test(slug) ||
    slug === "css2" ||
    slug === "css-mobile" ||
    slug === "css-print" ||
    slug === "css-tv"
  );
}

function isNonParserTargetSpecSlug(slug: string): boolean {
  return slug === "css-egg-1" || slug === "web-animations-2";
}

function isParserRelevantIndexSlug(slug: string): boolean {
  return parserRelevantSpecPrefixes.some(
    (prefix) => slug === prefix || slug.startsWith(`${prefix}-`),
  );
}

function parseLevelledSlug(
  slug: string,
): { readonly family: string; readonly level: number } | undefined {
  const match = /^(.*)-(\d+)$/.exec(slug);
  if (match === null) {
    return undefined;
  }
  const family = match[1];
  const level = Number(match[2]);
  if (family === undefined || !Number.isSafeInteger(level)) {
    return undefined;
  }
  return { family, level };
}
