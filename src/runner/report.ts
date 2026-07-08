import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CssSyntax,
  DifferentialFinding,
  FuzzCase,
  MinimizedFinding,
  ParseResult,
} from "../core/types.js";
import type { FuzzerEnvironment } from "./environment.js";

export interface WrittenFindingPaths {
  readonly jsonPath: string;
  readonly cssPath: string;
}

export interface FuzzRunReport {
  readonly command: "fuzz";
  readonly seed: string;
  readonly iterations: number;
  readonly syntax: CssSyntax;
  readonly timeoutMs: number;
  readonly minimize: boolean;
  readonly minimizeAttempts: number;
  readonly byteMinimize: boolean;
  readonly outDir: string;
  readonly specCorpusPath?: string;
  readonly knownDir?: string;
}

export interface RoundTripRunReport {
  readonly command: "verify-lightning-roundtrip" | "verify-prettier-roundtrip";
  readonly seed: string;
  readonly count: number;
  readonly syntax: CssSyntax;
  readonly timeoutMs: number;
  readonly minimize: boolean;
  readonly minimizeAttempts: number;
  readonly byteMinimize: boolean;
  readonly outDir: string;
  readonly specCorpusPath?: string;
  readonly knownDir?: string;
}

export interface RoundTripReportMetadata {
  readonly oracle: "lightning-roundtrip" | "prettier-roundtrip" | "prettier-format-crash";
  readonly originalCase: FuzzCase;
  readonly originalResults: readonly ParseResult[];
}

export type FindingRunReport = FuzzRunReport | RoundTripRunReport;

export interface FindingReportMetadata {
  readonly environment?: FuzzerEnvironment;
  readonly run?: FindingRunReport;
  readonly roundTrip?: RoundTripReportMetadata;
}

export interface FuzzCampaignCounts {
  readonly iterations: number;
  readonly newFindings: number;
  readonly knownSkipped: number;
  readonly duplicateSkipped: number;
  readonly knownSourceFingerprints: number;
  readonly knownIssueFamilies: number;
}

export interface FuzzCampaignNameCount {
  readonly name: string;
  readonly count: number;
}

export interface FuzzCampaignCoverage {
  readonly generatedTags: readonly FuzzCampaignNameCount[];
  readonly generatedSpecRefs: readonly FuzzCampaignNameCount[];
}

export interface FuzzCampaignSummary {
  readonly completedAt: string;
  readonly environment: FuzzerEnvironment;
  readonly run: FuzzRunReport;
  readonly counts: FuzzCampaignCounts;
  readonly coverage: FuzzCampaignCoverage;
  readonly findings: readonly WrittenFindingPaths[];
}

export interface RoundTripSummaryCounts {
  readonly generatedCases: number;
  readonly checkedOutputs: number;
  readonly knownSkipped: number;
  readonly duplicateSkipped: number;
  readonly mismatches: number;
  readonly writtenFindings: number;
  readonly skippedRejectedInputs?: number;
  readonly skippedMissingOutputs?: number;
  readonly skippedUnchangedOutputs?: number;
  readonly skippedInterestingInputs?: number;
  readonly skippedPrettierRejectedInputs?: number;
}

export interface RoundTripSummary {
  readonly completedAt: string;
  readonly environment: FuzzerEnvironment;
  readonly run: RoundTripRunReport;
  readonly counts: RoundTripSummaryCounts;
  readonly findings: readonly WrittenFindingPaths[];
}

export async function writeFinding(
  outDir: string,
  finding: DifferentialFinding | MinimizedFinding,
  metadata: FindingReportMetadata = {},
): Promise<WrittenFindingPaths> {
  await mkdir(outDir, { recursive: true });
  const testCase = "original" in finding ? finding.original.testCase : finding.testCase;
  const source = "minimizedSource" in finding ? finding.minimizedSource : finding.testCase.source;
  const basename = testCase.id;
  const cssPath = path.join(outDir, `${basename}.css`);
  const jsonPath = path.join(outDir, `${basename}.json`);
  const report = reportEnvelope(finding, metadata);
  await writeFile(cssPath, source.endsWith("\n") ? source : `${source}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { jsonPath, cssPath };
}

export async function writeCampaignSummary(
  outDir: string,
  summary: FuzzCampaignSummary,
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const summaryPath = path.join(outDir, "campaign-summary.json");
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return summaryPath;
}

export async function writeRoundTripSummary(
  outDir: string,
  summary: RoundTripSummary,
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const summaryPath = path.join(outDir, "roundtrip-summary.json");
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return summaryPath;
}

export function formatResults(results: readonly ParseResult[]): string {
  return results
    .map(
      (item) =>
        `${item.parser}=${item.status}${
          typeof item.message === "string" ? ` (${firstLine(item.message)})` : ""
        }`,
    )
    .join(", ");
}

function firstLine(value: string): string {
  return value.split("\n")[0] ?? value;
}

function reportEnvelope(
  finding: DifferentialFinding | MinimizedFinding,
  metadata: FindingReportMetadata,
):
  | DifferentialFinding
  | MinimizedFinding
  | (FindingReportMetadata & { readonly finding: DifferentialFinding | MinimizedFinding }) {
  if (
    metadata.environment === undefined &&
    metadata.run === undefined &&
    metadata.roundTrip === undefined
  ) {
    return finding;
  }
  return { ...metadata, finding };
}
