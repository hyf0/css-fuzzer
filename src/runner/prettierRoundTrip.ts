import { generateCase } from "../generator/generator.js";
import type { CssSyntax, FuzzCase, ParserAdapter, ParseResult } from "../core/types.js";
import { findingSourceFingerprint, runDifferentialCase } from "./differential.js";
import { findingSkipReason, type KnownFindingFingerprints } from "./findingDedup.js";
import { formatResults } from "./report.js";
import { formatCssWithPrettier, prettierFormatCrashFinding } from "./prettierFormatCrash.js";

export type PrettierFormatter = (source: string) => Promise<string>;

export interface PrettierRoundTripOptions {
  readonly adapters: readonly ParserAdapter[];
  readonly seed: bigint;
  readonly count: number;
  readonly syntax: CssSyntax;
  readonly timeoutMs: number;
  readonly knownFindings?: KnownFindingFingerprints;
  readonly formatter?: PrettierFormatter;
  readonly specCorpus: readonly {
    readonly source: string;
    readonly tags: readonly string[];
    readonly specRefs: readonly string[];
  }[];
}

export interface PrettierRoundTripMismatch {
  readonly originalCase: FuzzCase;
  readonly formattedCase?: FuzzCase;
  readonly formattedSource?: string;
  readonly originalResults: readonly ParseResult[];
  readonly roundTripResults?: readonly ParseResult[];
  readonly formatterErrorMessage?: string;
  readonly reason: string;
}

export interface PrettierRoundTripResult {
  readonly seed: string;
  readonly count: number;
  readonly syntax: CssSyntax;
  readonly generatedCases: number;
  readonly checkedOutputs: number;
  readonly skippedInterestingInputs: number;
  readonly skippedPrettierRejectedInputs: number;
  readonly skippedUnchangedOutputs: number;
  readonly knownSkipped: number;
  readonly duplicateSkipped: number;
  readonly mismatches: readonly PrettierRoundTripMismatch[];
}

export async function verifyPrettierRoundTrip(
  options: PrettierRoundTripOptions,
): Promise<PrettierRoundTripResult> {
  const mismatches: PrettierRoundTripMismatch[] = [];
  const knownFindings = options.knownFindings ?? { fingerprints: new Set(), families: new Set() };
  const seenFindings = new Set<string>();
  const formatter = options.formatter ?? formatCssWithPrettier;
  let checkedOutputs = 0;
  let skippedInterestingInputs = 0;
  let skippedPrettierRejectedInputs = 0;
  let skippedUnchangedOutputs = 0;
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
    const prettierResult = originalFinding.results.find(
      (result) => result.parser === "prettier-css",
    );
    if (prettierResult?.status !== "accepted") {
      skippedPrettierRejectedInputs += 1;
      continue;
    }
    if (originalFinding.interesting) {
      skippedInterestingInputs += 1;
      continue;
    }

    let formattedSource: string;
    try {
      formattedSource = await formatter(originalCase.source);
    } catch (error) {
      const formatterErrorMessage = firstLine(
        error instanceof Error ? error.message : String(error),
      );
      const crashFinding = prettierFormatCrashFinding(
        originalCase,
        originalFinding.results,
        formatterErrorMessage,
      );
      const skipReason = findingSkipReason(
        crashFinding.testCase.source,
        crashFinding.results,
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
        originalResults: originalFinding.results,
        formatterErrorMessage,
        reason: `Prettier format failed after parse accepted: ${formatterErrorMessage}`,
      });
      seenFindings.add(
        findingSourceFingerprint(crashFinding.testCase.source, crashFinding.results),
      );
      continue;
    }

    if (normalizeSource(formattedSource) === normalizeSource(originalCase.source)) {
      skippedUnchangedOutputs += 1;
      continue;
    }

    checkedOutputs += 1;
    const formattedCase = {
      ...originalCase,
      id: `${originalCase.id}-prettier-roundtrip`,
      source: formattedSource.endsWith("\n") ? formattedSource : `${formattedSource}\n`,
      tags: [...originalCase.tags, "prettier-roundtrip"],
    };
    const roundTripFinding = await runDifferentialCase(options.adapters, formattedCase, {
      syntax: options.syntax,
      timeoutMs: options.timeoutMs,
    });
    if (roundTripFinding.interesting) {
      const skipReason = findingSkipReason(
        formattedCase.source,
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
        formattedCase,
        formattedSource: formattedCase.source,
        originalResults: originalFinding.results,
        roundTripResults: roundTripFinding.results,
        reason: roundTripFinding.reason,
      });
      seenFindings.add(findingSourceFingerprint(formattedCase.source, roundTripFinding.results));
    }
  }

  return {
    seed: options.seed.toString(),
    count: options.count,
    syntax: options.syntax,
    generatedCases: options.count,
    checkedOutputs,
    skippedInterestingInputs,
    skippedPrettierRejectedInputs,
    skippedUnchangedOutputs,
    knownSkipped,
    duplicateSkipped,
    mismatches,
  };
}

export function prettierRoundTripPassed(result: PrettierRoundTripResult): boolean {
  return result.mismatches.length === 0;
}

export function formatPrettierRoundTrip(result: PrettierRoundTripResult): string {
  const lines = [
    `Prettier format roundtrip: seed ${result.seed}; count ${result.count}; syntax ${result.syntax}`,
    `Generated cases: ${result.generatedCases}; checked formatted outputs: ${result.checkedOutputs}`,
    `Skipped: ${result.skippedInterestingInputs} already-interesting inputs; ${result.skippedPrettierRejectedInputs} inputs not accepted by Prettier; ${result.skippedUnchangedOutputs} unchanged outputs`,
    `Known skipped: ${result.knownSkipped}; duplicate skipped: ${result.duplicateSkipped}`,
    `Roundtrip mismatches: ${result.mismatches.length}`,
  ];

  if (result.mismatches.length > 0) {
    lines.push("", "Mismatches:");
    for (const mismatch of result.mismatches.slice(0, 20)) {
      lines.push(`- ${mismatch.originalCase.id}: ${mismatch.reason}`);
      lines.push(`  original: ${formatResults(mismatch.originalResults)}`);
      if (mismatch.roundTripResults !== undefined) {
        lines.push(`  roundtrip: ${formatResults(mismatch.roundTripResults)}`);
      }
    }
    if (result.mismatches.length > 20) {
      lines.push(`- ... ${result.mismatches.length - 20} more mismatch(es)`);
    }
  }

  lines.push(
    "",
    prettierRoundTripPassed(result)
      ? "Prettier format roundtrip verification passed."
      : "Prettier format roundtrip verification failed.",
  );
  return `${lines.join("\n")}\n`;
}

function normalizeSource(source: string): string {
  return source.replace(/\r\n?/g, "\n").trim();
}

function firstLine(value: string): string {
  return value.split("\n")[0] ?? value;
}
