import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  loadSpecCorpus,
  readSpecCorpusAudit,
  specCorpusAgeHours,
} from "../generator/specCorpus.js";
import { curatedSpecSeeds, type SpecSeed } from "../generator/specSeeds.js";
import {
  requiredModernSpecSlugs,
  selectLatestCsswgSpecSlugs,
  type CsswgSpecEntry,
} from "../specs/fetchCsswg.js";

export interface SpecCorpusVerificationOptions {
  readonly path: string;
  readonly indexPath?: string;
  readonly requireLatestIndex?: boolean;
  readonly maxAgeHours?: number;
  readonly now?: Date;
  readonly requiredSlugs?: readonly string[];
  readonly curatedSeeds?: readonly SpecSeed[];
}

export interface SpecCorpusVerificationResult {
  readonly path: string;
  readonly fetchedAt?: string;
  readonly corpusAgeHours?: number;
  readonly maxAgeHours?: number;
  readonly corpusTimestampInvalid: boolean;
  readonly corpusStale: boolean;
  readonly selectedSpecs: number;
  readonly downloadedSpecs: number;
  readonly failedSpecs: readonly string[];
  readonly latestIndexPath: string;
  readonly latestIndexRequired: boolean;
  readonly latestIndexMissing: boolean;
  readonly latestIndexFetchedAt?: string;
  readonly latestIndexAgeHours?: number;
  readonly latestIndexTimestampInvalid: boolean;
  readonly latestIndexStale: boolean;
  readonly corpusIndexFetchedAtMismatch: boolean;
  readonly latestIndexSpecs?: number;
  readonly latestIndexSlugs: readonly string[];
  readonly extractedExamples: number;
  readonly normalizedExamples: number;
  readonly normalizedSpecSlugs: number;
  readonly curatedSpecSlugs: number;
  readonly requiredSlugs: readonly string[];
  readonly missingLatestSelected: readonly string[];
  readonly missingLatestDownloaded: readonly string[];
  readonly missingRequiredSelected: readonly string[];
  readonly missingRequiredDownloaded: readonly string[];
  readonly missingRequiredGeneratedCoverage: readonly string[];
  readonly selectedWithZeroExtractedExamples: readonly string[];
  readonly selectedWithZeroNormalizedExamples: readonly string[];
  readonly selectedWithZeroGeneratedCoverage: readonly string[];
}

export function verifySpecCorpus(
  options: SpecCorpusVerificationOptions,
): SpecCorpusVerificationResult {
  const audit = readSpecCorpusAudit(options.path);
  const normalized = loadSpecCorpus({ path: options.path });
  const curatedSeedsForAudit = options.curatedSeeds ?? curatedSpecSeeds;
  const requiredSlugs = options.requiredSlugs ?? requiredModernSpecSlugs;
  const latestIndexPath =
    options.indexPath ?? path.join(path.dirname(options.path), "csswg-index.json");
  const latestIndex = readLatestIndex(latestIndexPath);
  const ageHours = specCorpusAgeHours(audit.fetchedAt, options.now);
  const latestIndexAgeHours = specCorpusAgeHours(latestIndex?.fetchedAt, options.now);
  const selected = new Set(audit.selectedSlugs);
  const downloaded = new Set(audit.downloadedSlugs);
  const normalizedCounts = new Map<string, number>();
  for (const seed of normalized) {
    for (const slug of seed.specRefs) {
      normalizedCounts.set(slug, (normalizedCounts.get(slug) ?? 0) + 1);
    }
  }
  const curatedCounts = new Map<string, number>();
  for (const seed of curatedSeedsForAudit) {
    for (const slug of seed.specRefs) {
      curatedCounts.set(slug, (curatedCounts.get(slug) ?? 0) + 1);
    }
  }

  return {
    path: options.path,
    ...(audit.fetchedAt === undefined ? {} : { fetchedAt: audit.fetchedAt }),
    ...(ageHours === undefined ? {} : { corpusAgeHours: ageHours }),
    ...(options.maxAgeHours === undefined ? {} : { maxAgeHours: options.maxAgeHours }),
    corpusTimestampInvalid: audit.fetchedAt !== undefined && ageHours === undefined,
    corpusStale:
      options.maxAgeHours !== undefined && ageHours !== undefined && ageHours > options.maxAgeHours,
    selectedSpecs: audit.selectedSlugs.length,
    downloadedSpecs: audit.downloadedSlugs.length,
    failedSpecs: audit.failedSpecs,
    latestIndexPath,
    latestIndexRequired: options.requireLatestIndex === true,
    latestIndexMissing: latestIndex === undefined,
    ...(latestIndex?.fetchedAt === undefined
      ? {}
      : { latestIndexFetchedAt: latestIndex.fetchedAt }),
    ...(latestIndexAgeHours === undefined ? {} : { latestIndexAgeHours }),
    latestIndexTimestampInvalid: latestIndex !== undefined && latestIndexAgeHours === undefined,
    latestIndexStale:
      options.maxAgeHours !== undefined &&
      latestIndexAgeHours !== undefined &&
      latestIndexAgeHours > options.maxAgeHours,
    corpusIndexFetchedAtMismatch:
      audit.fetchedAt !== undefined &&
      latestIndex?.fetchedAt !== undefined &&
      audit.fetchedAt !== latestIndex.fetchedAt,
    ...(latestIndex === undefined ? {} : { latestIndexSpecs: latestIndex.specs }),
    latestIndexSlugs: latestIndex?.slugs ?? [],
    extractedExamples: audit.examples,
    normalizedExamples: normalized.length,
    normalizedSpecSlugs: normalizedCounts.size,
    curatedSpecSlugs: curatedCounts.size,
    requiredSlugs,
    missingLatestSelected: (latestIndex?.slugs ?? [])
      .filter((slug) => !selected.has(slug))
      .sort((a, b) => a.localeCompare(b)),
    missingLatestDownloaded: (latestIndex?.slugs ?? [])
      .filter((slug) => !downloaded.has(slug))
      .sort((a, b) => a.localeCompare(b)),
    missingRequiredSelected: requiredSlugs
      .filter((slug) => !selected.has(slug))
      .sort((a, b) => a.localeCompare(b)),
    missingRequiredDownloaded: requiredSlugs
      .filter((slug) => !downloaded.has(slug))
      .sort((a, b) => a.localeCompare(b)),
    missingRequiredGeneratedCoverage: requiredSlugs
      .filter((slug) => (normalizedCounts.get(slug) ?? 0) + (curatedCounts.get(slug) ?? 0) === 0)
      .sort((a, b) => a.localeCompare(b)),
    selectedWithZeroExtractedExamples: audit.selectedSlugs
      .filter((slug) => (audit.exampleCountsBySpec.get(slug) ?? 0) === 0)
      .sort((a, b) => a.localeCompare(b)),
    selectedWithZeroNormalizedExamples: audit.selectedSlugs
      .filter((slug) => (normalizedCounts.get(slug) ?? 0) === 0)
      .sort((a, b) => a.localeCompare(b)),
    selectedWithZeroGeneratedCoverage: audit.selectedSlugs
      .filter((slug) => (normalizedCounts.get(slug) ?? 0) + (curatedCounts.get(slug) ?? 0) === 0)
      .sort((a, b) => a.localeCompare(b)),
  };
}

export function specCorpusVerificationPassed(result: SpecCorpusVerificationResult): boolean {
  return (
    (!result.latestIndexRequired || !result.latestIndexMissing) &&
    !result.corpusTimestampInvalid &&
    !result.corpusStale &&
    !result.latestIndexTimestampInvalid &&
    !result.latestIndexStale &&
    !result.corpusIndexFetchedAtMismatch &&
    result.missingLatestSelected.length === 0 &&
    result.missingLatestDownloaded.length === 0 &&
    result.failedSpecs.length === 0 &&
    result.missingRequiredSelected.length === 0 &&
    result.missingRequiredDownloaded.length === 0 &&
    result.missingRequiredGeneratedCoverage.length === 0 &&
    result.selectedWithZeroGeneratedCoverage.length === 0
  );
}

export function formatSpecCorpusVerification(result: SpecCorpusVerificationResult): string {
  const latestSelected =
    result.latestIndexSlugs.length === 0
      ? 0
      : result.latestIndexSlugs.length - result.missingLatestSelected.length;
  const latestDownloaded =
    result.latestIndexSlugs.length === 0
      ? 0
      : result.latestIndexSlugs.length - result.missingLatestDownloaded.length;
  const lines = [
    `Spec corpus: ${result.path}`,
    `Selected specs: ${result.selectedSpecs}; downloaded specs: ${result.downloadedSpecs}; failed specs: ${result.failedSpecs.length}`,
    `Examples: extracted ${result.extractedExamples}; normalized ${result.normalizedExamples}; normalized spec slugs ${result.normalizedSpecSlugs}; curated spec slugs ${result.curatedSpecSlugs}`,
    formatLatestIndexSummary(result, latestSelected, latestDownloaded),
    `Required modern specs: ${result.requiredSlugs.length - result.missingRequiredDownloaded.length}/${result.requiredSlugs.length} downloaded; ${result.requiredSlugs.length - result.missingRequiredGeneratedCoverage.length}/${result.requiredSlugs.length} with generated coverage`,
  ];
  if (result.fetchedAt !== undefined) {
    const age =
      result.corpusAgeHours === undefined ? "" : `; age ${result.corpusAgeHours.toFixed(1)} hours`;
    const maxAge =
      result.maxAgeHours === undefined ? "" : `; freshness limit ${result.maxAgeHours} hours`;
    lines.splice(1, 0, `Fetched at: ${result.fetchedAt}${age}${maxAge}`);
  }

  if (result.corpusTimestampInvalid) {
    lines.push("", "Invalid spec corpus fetchedAt timestamp:");
    lines.push(`- ${result.fetchedAt ?? "(missing)"}`);
  }

  if (result.corpusStale) {
    lines.push("", "Spec corpus is older than the configured freshness limit:");
    lines.push(`- age ${result.corpusAgeHours?.toFixed(1) ?? "unknown"} hours`);
    lines.push(`- limit ${result.maxAgeHours ?? "unknown"} hours`);
  }

  if (result.latestIndexTimestampInvalid) {
    lines.push("", "Invalid CSSWG index fetchedAt timestamp:");
    lines.push(`- ${result.latestIndexFetchedAt ?? "(missing)"}`);
  }

  if (result.latestIndexStale) {
    lines.push("", "CSSWG index is older than the configured freshness limit:");
    lines.push(`- age ${result.latestIndexAgeHours?.toFixed(1) ?? "unknown"} hours`);
    lines.push(`- limit ${result.maxAgeHours ?? "unknown"} hours`);
  }

  if (result.corpusIndexFetchedAtMismatch) {
    lines.push("", "Spec corpus and CSSWG index were not produced by the same fetch:");
    lines.push(`- corpus fetchedAt ${result.fetchedAt ?? "(missing)"}`);
    lines.push(`- index fetchedAt ${result.latestIndexFetchedAt ?? "(missing)"}`);
  }

  if (result.failedSpecs.length > 0) {
    lines.push("", "Failed spec downloads:");
    for (const slug of result.failedSpecs) {
      lines.push(`- ${slug}`);
    }
  }

  if (result.latestIndexMissing && result.latestIndexRequired) {
    lines.push("", "Required CSSWG index file is missing:");
    lines.push(`- ${result.latestIndexPath}`);
  }

  if (result.missingLatestSelected.length > 0) {
    lines.push("", "Latest CSSWG family specs missing from selected set:");
    for (const slug of result.missingLatestSelected) {
      lines.push(`- ${slug}`);
    }
  }

  if (result.missingLatestDownloaded.length > 0) {
    lines.push("", "Latest CSSWG family specs missing from downloaded set:");
    for (const slug of result.missingLatestDownloaded) {
      lines.push(`- ${slug}`);
    }
  }

  if (result.missingRequiredSelected.length > 0) {
    lines.push("", "Required specs missing from selected set:");
    for (const slug of result.missingRequiredSelected) {
      lines.push(`- ${slug}`);
    }
  }

  if (result.missingRequiredDownloaded.length > 0) {
    lines.push("", "Required specs missing from downloaded set:");
    for (const slug of result.missingRequiredDownloaded) {
      lines.push(`- ${slug}`);
    }
  }

  if (result.missingRequiredGeneratedCoverage.length > 0) {
    lines.push("", "Required specs without generated coverage:");
    for (const slug of result.missingRequiredGeneratedCoverage) {
      lines.push(`- ${slug}`);
    }
  }

  if (result.selectedWithZeroExtractedExamples.length > 0) {
    lines.push("", "Selected specs with zero extracted examples:");
    for (const slug of result.selectedWithZeroExtractedExamples) {
      lines.push(`- ${slug}`);
    }
  }

  if (result.selectedWithZeroNormalizedExamples.length > 0) {
    lines.push("", "Selected specs with zero normalized examples:");
    for (const slug of result.selectedWithZeroNormalizedExamples) {
      lines.push(`- ${slug}`);
    }
  }

  if (result.selectedWithZeroGeneratedCoverage.length > 0) {
    lines.push("", "Selected specs with zero generated coverage:");
    for (const slug of result.selectedWithZeroGeneratedCoverage) {
      lines.push(`- ${slug}`);
    }
  }

  lines.push(
    "",
    specCorpusVerificationPassed(result)
      ? "Spec corpus verification passed."
      : "Spec corpus verification failed.",
  );
  return `${lines.join("\n")}\n`;
}

function readLatestIndex(
  indexPath: string,
):
  | { readonly fetchedAt?: string; readonly specs: number; readonly slugs: readonly string[] }
  | undefined {
  if (!existsSync(indexPath)) {
    return undefined;
  }
  const parsed = JSON.parse(readFileSync(indexPath, "utf8")) as CsswgIndexFile;
  const specs = (parsed.specs ?? []).flatMap((spec): CsswgSpecEntry[] => {
    if (typeof spec.slug !== "string") {
      return [];
    }
    return [
      {
        slug: spec.slug,
        title: typeof spec.title === "string" ? spec.title : spec.slug,
        url: typeof spec.url === "string" ? spec.url : `https://drafts.csswg.org/${spec.slug}/`,
        ...(typeof spec.date === "string" ? { date: spec.date } : {}),
      },
    ];
  });
  return {
    ...(typeof parsed.fetchedAt === "string" ? { fetchedAt: parsed.fetchedAt } : {}),
    specs: specs.length,
    slugs: selectLatestCsswgSpecSlugs(specs),
  };
}

function formatLatestIndexSummary(
  result: SpecCorpusVerificationResult,
  latestSelected: number,
  latestDownloaded: number,
): string {
  if (result.latestIndexMissing) {
    return `CSSWG index: missing at ${result.latestIndexPath}`;
  }
  const fetchedAt =
    result.latestIndexFetchedAt === undefined ? "" : `; fetched at ${result.latestIndexFetchedAt}`;
  const age =
    result.latestIndexAgeHours === undefined
      ? ""
      : `; age ${result.latestIndexAgeHours.toFixed(1)} hours`;
  return `CSSWG index: ${result.latestIndexPath}${fetchedAt}${age}; specs ${result.latestIndexSpecs ?? 0}; latest ${latestSelected}/${result.latestIndexSlugs.length} selected; ${latestDownloaded}/${result.latestIndexSlugs.length} downloaded`;
}

interface CsswgIndexFile {
  readonly fetchedAt?: unknown;
  readonly specs?: readonly UnknownCsswgSpecEntry[];
}

interface UnknownCsswgSpecEntry {
  readonly slug?: unknown;
  readonly title?: unknown;
  readonly url?: unknown;
  readonly date?: unknown;
}
