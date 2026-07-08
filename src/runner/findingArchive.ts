import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  isParserStatus,
  parserNames,
  type CssSyntax,
  type ParserAdapter,
  type ParseResult,
  type ParserName,
} from "../core/types.js";
import {
  classifyFinding,
  findingFamilyFingerprint,
  findingSourceFingerprint,
  runDifferentialCase,
} from "./differential.js";
import { findingSkipReason, type KnownFindingFingerprints } from "./findingDedup.js";
import { currentPrettierFormatCrashFinding } from "./prettierFormatCrash.js";
import { formatResults } from "./report.js";
import type { RoundTripReportMetadata } from "./report.js";

export interface FindingArchiveVerificationOptions {
  readonly findingsDir: string;
  readonly knownFindings: KnownFindingFingerprints;
  readonly syntax: CssSyntax;
  readonly replay?: {
    readonly adapters: readonly ParserAdapter[];
    readonly timeoutMs: number;
  };
}

export interface FindingReportEntry {
  readonly file: string;
  readonly id: string;
  readonly source: string;
  readonly results: readonly ParseResult[];
  readonly reason: string;
  readonly oracle?: RoundTripReportMetadata["oracle"];
}

export interface UnarchivedFindingReport {
  readonly file: string;
  readonly id: string;
  readonly reason: string;
  readonly sourceFingerprint: string;
  readonly familyFingerprint?: string;
  readonly results: readonly ParseResult[];
}

export interface StaleFindingReport {
  readonly file: string;
  readonly id: string;
  readonly storedResults: readonly ParseResult[];
  readonly currentResults: readonly ParseResult[];
  readonly currentReason: string;
}

export interface FindingArchiveVerificationResult {
  readonly findingReports: readonly FindingReportEntry[];
  readonly coveredReports: readonly FindingReportEntry[];
  readonly staleReports: readonly StaleFindingReport[];
  readonly unarchivedReports: readonly UnarchivedFindingReport[];
  readonly knownSourceFingerprints: number;
  readonly knownIssueFamilies: number;
}

export async function verifyFindingArchive(
  options: FindingArchiveVerificationOptions,
): Promise<FindingArchiveVerificationResult> {
  const files = await collectFindingReportFiles(options.findingsDir);
  const findingReports: FindingReportEntry[] = [];
  for (const file of files) {
    findingReports.push(await readFindingReport(file));
  }

  const coveredReports: FindingReportEntry[] = [];
  const staleReports: StaleFindingReport[] = [];
  const unarchivedReports: UnarchivedFindingReport[] = [];
  for (const report of findingReports) {
    const currentFinding = await currentFindingForReport(report, options);
    if (!currentFinding.interesting) {
      staleReports.push({
        file: report.file,
        id: report.id,
        storedResults: report.results,
        currentResults: currentFinding.results,
        currentReason: currentFinding.reason,
      });
      continue;
    }

    const skipReason = findingSkipReason(
      report.source,
      currentFinding.results,
      options.knownFindings,
      new Set(),
    );
    if (skipReason === "known") {
      coveredReports.push(report);
      continue;
    }
    const familyFingerprint = findingFamilyFingerprint(report.source, currentFinding.results);
    unarchivedReports.push({
      file: report.file,
      id: report.id,
      reason: currentFinding.reason,
      sourceFingerprint: findingSourceFingerprint(report.source, currentFinding.results),
      ...(familyFingerprint === undefined ? {} : { familyFingerprint }),
      results: currentFinding.results,
    });
  }

  return {
    findingReports,
    coveredReports,
    staleReports,
    unarchivedReports,
    knownSourceFingerprints: options.knownFindings.fingerprints.size,
    knownIssueFamilies: options.knownFindings.families.size,
  };
}

export function findingArchiveVerificationPassed(
  result: FindingArchiveVerificationResult,
): boolean {
  return result.unarchivedReports.length === 0;
}

export function formatFindingArchiveVerification(
  result: FindingArchiveVerificationResult,
  findingsDir: string,
): string {
  const lines = [
    `Finding archive coverage: ${findingsDir}`,
    `Reports checked: ${result.findingReports.length}; covered by known cases: ${result.coveredReports.length}; unarchived: ${result.unarchivedReports.length}; stale or currently not interesting: ${result.staleReports.length}`,
    `Known source fingerprints: ${result.knownSourceFingerprints}; known issue families: ${result.knownIssueFamilies}`,
  ];

  if (result.unarchivedReports.length > 0) {
    lines.push("", "Unarchived finding reports:");
    for (const report of result.unarchivedReports) {
      lines.push(`- ${report.file}: ${report.id}: ${report.reason}`);
      lines.push(`  ${formatResults(report.results)}`);
      lines.push(`  source fingerprint: ${report.sourceFingerprint}`);
      if (report.familyFingerprint !== undefined) {
        lines.push(`  family fingerprint: ${report.familyFingerprint}`);
      }
    }
  }

  if (result.staleReports.length > 0) {
    lines.push("", "Reports that are no longer interesting with the checked parser matrix:");
    for (const report of result.staleReports) {
      lines.push(`- ${report.file}: ${report.id}`);
      lines.push(`  current: ${formatResults(report.currentResults)}`);
      lines.push(`  stored: ${formatResults(report.storedResults)}`);
      lines.push(`  ${report.currentReason}`);
    }
  }

  lines.push(
    "",
    findingArchiveVerificationPassed(result)
      ? "Finding archive verification passed."
      : "Finding archive verification failed.",
  );
  return `${lines.join("\n")}\n`;
}

async function currentFindingForReport(
  report: FindingReportEntry,
  options: FindingArchiveVerificationOptions,
) {
  const testCase = {
    id: report.id,
    seed: report.file,
    syntax: options.syntax,
    source: report.source,
    tags: ["finding-report"],
    specRefs: [],
  };
  if (options.replay !== undefined && report.oracle === "prettier-format-crash") {
    return await currentPrettierFormatCrashFinding(testCase, options.replay.adapters, {
      syntax: options.syntax,
      timeoutMs: options.replay.timeoutMs,
    });
  }
  if (options.replay === undefined) {
    return classifyFinding(testCase, report.results);
  }
  return await runDifferentialCase(options.replay.adapters, testCase, {
    syntax: options.syntax,
    timeoutMs: options.replay.timeoutMs,
  });
}

export async function collectFindingReportFiles(root: string): Promise<readonly string[]> {
  const info = await stat(root);
  if (info.isFile()) {
    return isFindingReportPath(root) ? [root] : [];
  }

  const files: string[] = [];
  await collectFindingReportFilesInto(root, files);
  return files.sort((left, right) => left.localeCompare(right));
}

export async function readFindingReport(file: string): Promise<FindingReportEntry> {
  const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  const oracle = roundTripOracle(raw, file);
  const finding = objectValue(raw, "finding") ?? raw;
  if (isObject(finding) && typeof finding.minimizedSource === "string") {
    const original = objectValue(finding, "original");
    const originalTestCase = objectValue(original, "testCase");
    return {
      file,
      id: stringValue(originalTestCase, "id", file),
      source: finding.minimizedSource,
      results: parseResults(arrayValue(finding, "minimizedResults", file), file),
      reason: stringValue(original, "reason", file),
      ...(oracle === undefined ? {} : { oracle }),
    };
  }

  if (isObject(finding)) {
    const testCase = objectValue(finding, "testCase");
    return {
      file,
      id: stringValue(testCase, "id", file),
      source: stringValue(testCase, "source", file),
      results: parseResults(arrayValue(finding, "results", file), file),
      reason: stringValue(finding, "reason", file),
      ...(oracle === undefined ? {} : { oracle }),
    };
  }

  throw new Error(`Finding report ${file} must contain a finding object`);
}

async function collectFindingReportFilesInto(dir: string, files: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFindingReportFilesInto(fullPath, files);
    } else if (entry.isFile() && isFindingReportPath(fullPath)) {
      files.push(fullPath);
    }
  }
}

function isFindingReportPath(file: string): boolean {
  return (
    file.endsWith(".json") &&
    path.basename(file) !== "campaign-summary.json" &&
    path.basename(file) !== "roundtrip-summary.json"
  );
}

function roundTripOracle(
  value: unknown,
  file: string,
): RoundTripReportMetadata["oracle"] | undefined {
  const roundTrip = objectValue(value, "roundTrip");
  if (roundTrip === undefined) {
    return undefined;
  }
  const oracle = roundTrip.oracle;
  if (
    oracle === "lightning-roundtrip" ||
    oracle === "prettier-roundtrip" ||
    oracle === "prettier-format-crash"
  ) {
    return oracle;
  }
  throw new Error(`Finding report ${file} contains unknown roundtrip oracle "${String(oracle)}"`);
}

function parseResults(values: readonly unknown[], file: string): readonly ParseResult[] {
  return values.map((value, index) => {
    if (!isObject(value)) {
      throw new Error(`Finding report ${file} result ${index} must be an object`);
    }
    const parser = stringValue(value, "parser", file);
    if (!(parserNames as readonly string[]).includes(parser)) {
      throw new Error(`Finding report ${file} result ${index} has unknown parser "${parser}"`);
    }
    const status = stringValue(value, "status", file);
    if (!isParserStatus(status)) {
      throw new Error(`Finding report ${file} result ${index} has unknown status "${status}"`);
    }
    const durationMs = numberValue(value, "durationMs", file);
    const message = optionalStringValue(value, "message", file);
    return {
      parser: parser as ParserName,
      status,
      durationMs,
      ...(message === undefined ? {} : { message }),
      ...(Object.hasOwn(value, "detail") ? { detail: value.detail } : {}),
    };
  });
}

function objectValue(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const nested = value[key];
  return isObject(nested) ? nested : undefined;
}

function arrayValue(value: unknown, key: string, file: string): readonly unknown[] {
  if (!isObject(value) || !Array.isArray(value[key])) {
    throw new Error(`Finding report ${file} must contain array field "${key}"`);
  }
  return value[key];
}

function stringValue(value: unknown, key: string, file: string): string {
  if (!isObject(value) || typeof value[key] !== "string") {
    throw new Error(`Finding report ${file} must contain string field "${key}"`);
  }
  return value[key];
}

function optionalStringValue(
  value: Record<string, unknown>,
  key: string,
  file: string,
): string | undefined {
  const item = value[key];
  if (item === undefined) {
    return undefined;
  }
  if (typeof item !== "string") {
    throw new Error(`Finding report ${file} field "${key}" must be a string`);
  }
  return item;
}

function numberValue(value: unknown, key: string, file: string): number {
  if (!isObject(value) || typeof value[key] !== "number") {
    throw new Error(`Finding report ${file} must contain number field "${key}"`);
  }
  return value[key];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
