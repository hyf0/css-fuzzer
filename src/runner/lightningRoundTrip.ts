import { generateCase } from "../generator/generator.js";
import type { CssSyntax, FuzzCase, ParserAdapter, ParseResult } from "../core/types.js";
import { findingSourceFingerprint, runDifferentialCase } from "./differential.js";
import { findingSkipReason, type KnownFindingFingerprints } from "./findingDedup.js";
import { formatResults } from "./report.js";

export interface LightningRoundTripOptions {
  readonly adapters: readonly ParserAdapter[];
  readonly seed: bigint;
  readonly count: number;
  readonly syntax: CssSyntax;
  readonly timeoutMs: number;
  readonly knownFindings?: KnownFindingFingerprints;
  readonly specCorpus: readonly {
    readonly source: string;
    readonly tags: readonly string[];
    readonly specRefs: readonly string[];
  }[];
}

export interface LightningRoundTripMismatch {
  readonly originalCase: FuzzCase;
  readonly transformedCase: FuzzCase;
  readonly transformedSource: string;
  readonly originalResults: readonly ParseResult[];
  readonly roundTripResults: readonly ParseResult[];
  readonly reason: string;
}

export interface LightningRoundTripResult {
  readonly seed: string;
  readonly count: number;
  readonly syntax: CssSyntax;
  readonly generatedCases: number;
  readonly checkedOutputs: number;
  readonly skippedUnchangedOutputs: number;
  readonly skippedMissingOutputs: number;
  readonly skippedRejectedInputs: number;
  readonly knownSkipped: number;
  readonly duplicateSkipped: number;
  readonly mismatches: readonly LightningRoundTripMismatch[];
}

export async function verifyLightningRoundTrip(
  options: LightningRoundTripOptions,
): Promise<LightningRoundTripResult> {
  const mismatches: LightningRoundTripMismatch[] = [];
  const knownFindings = options.knownFindings ?? { fingerprints: new Set(), families: new Set() };
  const seenFindings = new Set<string>();
  let checkedOutputs = 0;
  let skippedUnchangedOutputs = 0;
  let skippedMissingOutputs = 0;
  let skippedRejectedInputs = 0;
  let knownSkipped = 0;
  let duplicateSkipped = 0;

  for (let index = 0; index < options.count; index += 1) {
    const originalCase = generateCase(options.seed + BigInt(index), {
      syntax: options.syntax,
      specCorpus: options.specCorpus,
    });
    const originalFinding = await runDifferentialCase(options.adapters, originalCase, {
      syntax: options.syntax,
      timeoutMs: options.timeoutMs,
    });
    const lightningResult = originalFinding.results.find(
      (result) => result.parser === "lightningcss",
    );
    if (lightningResult?.status !== "accepted") {
      skippedRejectedInputs += 1;
      continue;
    }

    const transformedSource = lightningTransformedSource(lightningResult);
    if (transformedSource === undefined) {
      skippedMissingOutputs += 1;
      continue;
    }
    if (normalizeSource(transformedSource) === normalizeSource(originalCase.source)) {
      skippedUnchangedOutputs += 1;
      continue;
    }

    checkedOutputs += 1;
    const transformedCase = {
      ...originalCase,
      id: `${originalCase.id}-lightning-roundtrip`,
      source: transformedSource.endsWith("\n") ? transformedSource : `${transformedSource}\n`,
      tags: [...originalCase.tags, "lightning-roundtrip"],
    };
    const roundTripFinding = await runDifferentialCase(options.adapters, transformedCase, {
      syntax: options.syntax,
      timeoutMs: options.timeoutMs,
    });
    if (roundTripFinding.interesting) {
      const skipReason = findingSkipReason(
        transformedCase.source,
        roundTripFinding.results,
        knownFindings,
        seenFindings,
      );
      if (skipReason === "known") {
        knownSkipped += 1;
        continue;
      }
      if (skipReason === "duplicate") {
        duplicateSkipped += 1;
        continue;
      }
      mismatches.push({
        originalCase,
        transformedCase,
        transformedSource: transformedCase.source,
        originalResults: originalFinding.results,
        roundTripResults: roundTripFinding.results,
        reason: roundTripFinding.reason,
      });
      seenFindings.add(findingSourceFingerprint(transformedCase.source, roundTripFinding.results));
    }
  }

  return {
    seed: options.seed.toString(),
    count: options.count,
    syntax: options.syntax,
    generatedCases: options.count,
    checkedOutputs,
    skippedUnchangedOutputs,
    skippedMissingOutputs,
    skippedRejectedInputs,
    knownSkipped,
    duplicateSkipped,
    mismatches,
  };
}

export function lightningRoundTripPassed(result: LightningRoundTripResult): boolean {
  return result.mismatches.length === 0;
}

export function formatLightningRoundTrip(result: LightningRoundTripResult): string {
  const lines = [
    `Lightning output roundtrip: seed ${result.seed}; count ${result.count}; syntax ${result.syntax}`,
    `Generated cases: ${result.generatedCases}; checked transformed outputs: ${result.checkedOutputs}`,
    `Skipped: ${result.skippedRejectedInputs} inputs not accepted by lightningcss; ${result.skippedMissingOutputs} missing transformed outputs; ${result.skippedUnchangedOutputs} unchanged outputs`,
    `Known skipped: ${result.knownSkipped}; duplicate skipped: ${result.duplicateSkipped}`,
    `Roundtrip mismatches: ${result.mismatches.length}`,
  ];

  if (result.mismatches.length > 0) {
    lines.push("", "Mismatches:");
    for (const mismatch of result.mismatches.slice(0, 20)) {
      lines.push(`- ${mismatch.originalCase.id}: ${mismatch.reason}`);
      lines.push(`  original: ${formatResults(mismatch.originalResults)}`);
      lines.push(`  roundtrip: ${formatResults(mismatch.roundTripResults)}`);
    }
    if (result.mismatches.length > 20) {
      lines.push(`- ... ${result.mismatches.length - 20} more mismatch(es)`);
    }
  }

  lines.push(
    "",
    lightningRoundTripPassed(result)
      ? "Lightning output roundtrip verification passed."
      : "Lightning output roundtrip verification failed.",
  );
  return `${lines.join("\n")}\n`;
}

function lightningTransformedSource(result: ParseResult): string | undefined {
  const detail = result.detail;
  if (detail === undefined || typeof detail !== "object" || detail === null) {
    return undefined;
  }
  const value = (detail as { readonly transformedSource?: unknown }).transformedSource;
  return typeof value === "string" ? value : undefined;
}

function normalizeSource(source: string): string {
  return source.replace(/\r\n?/g, "\n").trim();
}
