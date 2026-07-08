#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { generateCase } from "./generator/generator.js";
import {
  assertAuditableSpecCorpus,
  loadSpecCorpus,
  readSpecCorpusAudit,
} from "./generator/specCorpus.js";
import { createDefaultAdapters } from "./parsers/index.js";
import { fetchCsswgSpecs } from "./specs/fetchCsswg.js";
import { closeJsParserWorkers } from "./parsers/jsWorker.js";
import {
  findingSourceFingerprint,
  preservesFindingIdentity,
  runDifferentialCase,
} from "./runner/differential.js";
import {
  findingSkipReason,
  knownFindingsFromReplayRows,
  mergeKnownFindings,
  type KnownFindingFingerprints,
} from "./runner/findingDedup.js";
import { reportableFinding } from "./runner/minimizedFinding.js";
import { minimizeText } from "./runner/shrink.js";
import {
  formatResults,
  writeCampaignSummary,
  writeFinding,
  writeRoundTripSummary,
  type FuzzRunReport,
  type RoundTripRunReport,
  type RoundTripSummaryCounts,
  type WrittenFindingPaths,
} from "./runner/report.js";
import { collectCssFiles, formatReplayMarkdown, replayCssFiles } from "./runner/replay.js";
import { collectEnvironment } from "./runner/environment.js";
import { benchmarkAdapters, formatAdapterBenchmark } from "./runner/adapterBenchmark.js";
import {
  assertRequiredAdaptersAvailable,
  verifyRequiredAdapters,
} from "./runner/adapterAvailability.js";
import {
  caseRepoVerificationPassed,
  formatCaseRepoVerification,
  verifyCaseRepo,
} from "./runner/caseRepo.js";
import {
  formatSpecCorpusVerification,
  specCorpusVerificationPassed,
  verifySpecCorpus,
} from "./runner/specCorpusVerification.js";
import {
  formatGeneratorCoverage,
  generatorCoveragePassed,
  verifyGeneratorCoverage,
} from "./runner/generatorCoverage.js";
import {
  findingArchiveVerificationPassed,
  formatFindingArchiveVerification,
  verifyFindingArchive,
} from "./runner/findingArchive.js";
import {
  formatLightningRoundTrip,
  lightningRoundTripPassed,
  type LightningRoundTripResult,
  verifyLightningRoundTrip,
} from "./runner/lightningRoundTrip.js";
import {
  formatPrettierRoundTrip,
  prettierRoundTripPassed,
  type PrettierRoundTripResult,
  verifyPrettierRoundTrip,
} from "./runner/prettierRoundTrip.js";
import {
  minimizePrettierFormatCrashFinding,
  prettierFormatCrashRowsFromReplayRows,
  prettierFormatCrashFinding,
} from "./runner/prettierFormatCrash.js";
import {
  assertKnownArgs,
  parseArgs,
  parseBigIntArg,
  parseBooleanFlagArg,
  parseOptionalPositiveIntegerArg,
  parsePositiveIntegerArg,
  parseSyntax,
  optionalStringArg,
  requiredStringArg,
  stringArg,
  type ParsedArgs,
} from "./cliArgs.js";
import type {
  CssSyntax,
  DifferentialFinding,
  FuzzCase,
  MinimizedFinding,
  ParseResult,
  RunOptions,
} from "./core/types.js";

const defaultTimeoutMs = 2_000;
const defaultSpecCorpusMaxAgeHours = 72;

const specCorpusArgNames = [
  "spec-corpus",
  "max-spec-examples",
  "max-spec-corpus-age-hours",
  "no-spec-corpus",
] as const;

const commandOptionNames = {
  generate: new Set(["seed", "count", "syntax", ...specCorpusArgNames]),
  run: new Set([
    "seed",
    "iterations",
    "syntax",
    "timeout-ms",
    "minimize",
    "minimize-attempts",
    "byte-minimize",
    "out",
    "known-dir",
    ...specCorpusArgNames,
  ]),
  "fetch-specs": new Set([
    "out",
    "download",
    "slugs",
    "max-examples-per-spec",
    "allow-fetch-failures",
  ]),
  replay: new Set(["file", "dir", "syntax", "timeout-ms"]),
  "bench-adapters": new Set(["iterations", "syntax", "timeout-ms", "source"]),
  "verify-cases": new Set([
    "dir",
    "cases-dir",
    "readme",
    "syntax",
    "timeout-ms",
    "check-minimized",
    "minimize-attempts",
    "byte-minimize",
  ]),
  "verify-spec-corpus": new Set(["spec-corpus", "spec-index", "max-spec-corpus-age-hours"]),
  "verify-generator-coverage": new Set([
    "seed",
    "count",
    "syntax",
    "require-selected-specs",
    ...specCorpusArgNames,
  ]),
  "verify-findings-known": new Set(["findings-dir", "dir", "known-dir", "syntax", "timeout-ms"]),
  "verify-lightning-roundtrip": new Set([
    "seed",
    "count",
    "syntax",
    "timeout-ms",
    "known-dir",
    "out",
    "minimize",
    "minimize-attempts",
    "byte-minimize",
    ...specCorpusArgNames,
  ]),
  "verify-prettier-roundtrip": new Set([
    "seed",
    "count",
    "syntax",
    "timeout-ms",
    "known-dir",
    "out",
    "minimize",
    "minimize-attempts",
    "byte-minimize",
    ...specCorpusArgNames,
  ]),
  reduce: new Set(["file", "syntax", "timeout-ms", "minimize-attempts", "byte-minimize", "out"]),
} as const satisfies Record<string, ReadonlySet<string>>;

async function main(argv: readonly string[]): Promise<void> {
  const [command = "run", ...rest] = argv;
  const args = parseArgs(rest);

  switch (command) {
    case "generate":
      assertKnownArgs(args, commandOptionNames.generate, command);
      runGenerate(args);
      return;
    case "run":
    case "fuzz":
      assertKnownArgs(args, commandOptionNames.run, command);
      await runFuzz(args);
      return;
    case "fetch-specs":
      assertKnownArgs(args, commandOptionNames["fetch-specs"], command);
      await runFetchSpecs(args);
      return;
    case "replay":
      assertKnownArgs(args, commandOptionNames.replay, command);
      await runReplay(args);
      return;
    case "bench-adapters":
      assertKnownArgs(args, commandOptionNames["bench-adapters"], command);
      await runBenchAdapters(args);
      return;
    case "verify-cases":
      assertKnownArgs(args, commandOptionNames["verify-cases"], command);
      await runVerifyCases(args);
      return;
    case "verify-spec-corpus":
      assertKnownArgs(args, commandOptionNames["verify-spec-corpus"], command);
      runVerifySpecCorpus(args);
      return;
    case "verify-generator-coverage":
      assertKnownArgs(args, commandOptionNames["verify-generator-coverage"], command);
      runVerifyGeneratorCoverage(args);
      return;
    case "verify-findings-known":
      assertKnownArgs(args, commandOptionNames["verify-findings-known"], command);
      await runVerifyFindingsKnown(args);
      return;
    case "verify-lightning-roundtrip":
      assertKnownArgs(args, commandOptionNames["verify-lightning-roundtrip"], command);
      await runVerifyLightningRoundTrip(args);
      return;
    case "verify-prettier-roundtrip":
      assertKnownArgs(args, commandOptionNames["verify-prettier-roundtrip"], command);
      await runVerifyPrettierRoundTrip(args);
      return;
    case "reduce":
      assertKnownArgs(args, commandOptionNames.reduce, command);
      await runReduce(args);
      return;
    default:
      throw new Error(`Unknown command "${command}"`);
  }
}

function runGenerate(args: ParsedArgs): void {
  const seed = parseBigIntArg(args, "seed", 1n);
  const count = parsePositiveIntegerArg(args, "count", 1);
  const syntax = parseSyntax(stringArg(args, "syntax", "css"));
  const specCorpus = loadSpecCorpusFromArgs(args);
  for (let index = 0; index < count; index += 1) {
    const testCase = generateCase(seed + BigInt(index), { syntax, specCorpus });
    process.stdout.write(`/* ${testCase.id} ${testCase.tags.join(",")} */\n${testCase.source}\n`);
  }
}

async function runFuzz(args: ParsedArgs): Promise<void> {
  const options: RunOptions = {
    seed: parseBigIntArg(args, "seed", 1n),
    iterations: parsePositiveIntegerArg(args, "iterations", 100),
    syntax: parseSyntax(stringArg(args, "syntax", "css")),
    timeoutMs: parsePositiveIntegerArg(args, "timeout-ms", defaultTimeoutMs),
    minimize: parseBooleanFlagArg(args, "minimize"),
    minimizeAttempts: parsePositiveIntegerArg(args, "minimize-attempts", 80),
    byteMinimize: parseBooleanFlagArg(args, "byte-minimize"),
  };
  const outDir = stringArg(args, "out", "findings/cases");
  const specCorpus = loadSpecCorpusFromArgs(args);
  const specCorpusPath = specCorpusPathFromArgs(args);
  const environment = collectEnvironment(specCorpusPath === undefined ? {} : { specCorpusPath });
  const knownDir = stringArg(args, "known-dir", "");
  const runReport: FuzzRunReport = {
    command: "fuzz",
    seed: options.seed.toString(),
    iterations: options.iterations,
    syntax: options.syntax,
    timeoutMs: options.timeoutMs,
    minimize: options.minimize,
    minimizeAttempts: options.minimizeAttempts,
    byteMinimize: options.byteMinimize,
    outDir,
    ...(specCorpusPath === undefined ? {} : { specCorpusPath }),
    ...(knownDir === "" ? {} : { knownDir }),
  };
  await mkdir(outDir, { recursive: true });
  const adapters = createDefaultAdapters();
  await assertDefaultAdaptersAvailable(adapters, {
    syntax: options.syntax,
    timeoutMs: options.timeoutMs,
  });
  const knownFindings = await loadKnownFindings(args, adapters, {
    syntax: options.syntax,
    timeoutMs: options.timeoutMs,
  });
  const knownCount = knownFindings.fingerprints.size + knownFindings.families.size;
  if (knownCount > 0) {
    process.stderr.write(
      `Loaded ${knownFindings.fingerprints.size} known source fingerprints and ${knownFindings.families.size} known issue families.\n`,
    );
  }

  let interestingCount = 0;
  let knownSkippedCount = 0;
  let duplicateSkippedCount = 0;
  const writtenFindings: WrittenFindingPaths[] = [];
  const seenFindings = new Set<string>();
  const generatedTags = new Map<string, number>();
  const generatedSpecRefs = new Map<string, number>();
  for (let index = 0; index < options.iterations; index += 1) {
    const testCase = generateCase(options.seed + BigInt(index), {
      syntax: options.syntax,
      specCorpus,
    });
    incrementCounts(generatedTags, testCase.tags);
    incrementCounts(generatedSpecRefs, testCase.specRefs);
    const finding = await runDifferentialCase(adapters, testCase, {
      syntax: options.syntax,
      timeoutMs: options.timeoutMs,
    });
    if (!finding.interesting) {
      continue;
    }
    const rawSourceFingerprint = findingSourceFingerprint(testCase.source, finding.results);
    const rawSkipReason = findingSkipReason(
      testCase.source,
      finding.results,
      knownFindings,
      seenFindings,
    );
    if (rawSkipReason === "known") {
      knownSkippedCount += 1;
      continue;
    }
    if (rawSkipReason === "duplicate") {
      duplicateSkippedCount += 1;
      continue;
    }
    seenFindings.add(rawSourceFingerprint);

    const minimized = options.minimize
      ? await minimizeFinding(finding, options, adapters)
      : finding;
    const output = reportableFinding(finding, minimized);
    if (output !== minimized) {
      process.stderr.write(
        `[warn] Discarded unstable minimized output for ${testCase.id}; writing the original finding.\n`,
      );
    }
    const outputSource =
      "minimizedSource" in output ? output.minimizedSource : output.testCase.source;
    const results = "minimizedResults" in output ? output.minimizedResults : output.results;
    const outputSourceFingerprint = findingSourceFingerprint(outputSource, results);
    const outputSkipReason = findingSkipReason(outputSource, results, knownFindings, seenFindings, {
      ignoreSourceFingerprint: rawSourceFingerprint,
    });
    if (outputSkipReason === "known") {
      knownSkippedCount += 1;
      continue;
    }
    if (outputSkipReason === "duplicate") {
      duplicateSkippedCount += 1;
      continue;
    }
    seenFindings.add(outputSourceFingerprint);

    interestingCount += 1;
    const paths = await writeFinding(outDir, output, { environment, run: runReport });
    writtenFindings.push(paths);
    process.stdout.write(`[interesting] ${testCase.id}: ${finding.reason}\n`);
    process.stdout.write(`  ${formatResults(results)}\n`);
    process.stdout.write(`  wrote ${paths.cssPath} and ${paths.jsonPath}\n`);
  }

  const summaryPath = await writeCampaignSummary(outDir, {
    completedAt: new Date().toISOString(),
    environment,
    run: runReport,
    counts: {
      iterations: options.iterations,
      newFindings: interestingCount,
      knownSkipped: knownSkippedCount,
      duplicateSkipped: duplicateSkippedCount,
      knownSourceFingerprints: knownFindings.fingerprints.size,
      knownIssueFamilies: knownFindings.families.size,
    },
    coverage: {
      generatedTags: sortedNameCounts(generatedTags),
      generatedSpecRefs: sortedNameCounts(generatedSpecRefs),
    },
    findings: writtenFindings,
  });
  process.stdout.write(
    `Completed ${options.iterations} iterations; interesting findings: ${interestingCount}; known skipped: ${knownSkippedCount}; duplicate skipped: ${duplicateSkippedCount}\n`,
  );
  process.stdout.write(`Wrote campaign summary: ${summaryPath}\n`);
}

async function minimizeFinding(
  finding: DifferentialFinding,
  options: RunOptions,
  adapters: ReturnType<typeof createDefaultAdapters>,
): Promise<MinimizedFinding> {
  const minimized = await minimizeText(
    finding.testCase.source,
    async (candidate) => {
      const candidateFinding = await runDifferentialCase(
        adapters,
        { ...finding.testCase, source: candidate },
        { syntax: options.syntax, timeoutMs: options.timeoutMs },
      );
      return (
        candidateFinding.interesting &&
        preservesFindingIdentity(
          finding.testCase.source,
          finding.results,
          candidate,
          candidateFinding.results,
        )
      );
    },
    { maxAttempts: options.minimizeAttempts, allowByteLevel: options.byteMinimize },
  );
  const replay = await runDifferentialCase(
    adapters,
    { ...finding.testCase, source: minimized.source },
    { syntax: options.syntax, timeoutMs: options.timeoutMs },
  );
  return {
    original: finding,
    minimizedSource: minimized.source,
    minimizedResults: replay.results,
    attempts: minimized.attempts,
  };
}

function incrementCounts(counts: Map<string, number>, values: readonly string[]): void {
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
}

function sortedNameCounts(counts: ReadonlyMap<string, number>) {
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

async function runFetchSpecs(args: ParsedArgs): Promise<void> {
  const outDir = stringArg(args, "out", "data/specs");
  const downloadSpecs = parseBooleanFlagArg(args, "download");
  const slugsArg = optionalStringArg(args, "slugs");
  const slugs =
    slugsArg === undefined
      ? undefined
      : slugsArg
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
  const maxExamplesPerSpec = parseOptionalPositiveIntegerArg(args, "max-examples-per-spec");
  const result = await fetchCsswgSpecs({
    outDir,
    downloadSpecs,
    allowFetchFailures: parseBooleanFlagArg(args, "allow-fetch-failures"),
    ...(maxExamplesPerSpec === undefined ? {} : { maxExamplesPerSpec }),
    ...(slugs === undefined ? {} : { slugs }),
  });
  process.stdout.write(`Fetched CSSWG index with ${result.specs.length} specs`);
  if (downloadSpecs) {
    process.stdout.write(` and ${result.examples.length} extracted examples`);
  }
  process.stdout.write(".\n");
}

async function runReplay(args: ParsedArgs): Promise<void> {
  const inputPath = requiredStringArg(args, "file", "dir");
  const syntax = parseSyntax(stringArg(args, "syntax", "css"));
  const timeoutMs = parsePositiveIntegerArg(args, "timeout-ms", defaultTimeoutMs);
  const files = await collectCssFiles(inputPath);
  const adapters = createDefaultAdapters();
  await assertDefaultAdaptersAvailable(adapters, { syntax, timeoutMs });
  const rows = await replayCssFiles(files, adapters, { syntax, timeoutMs });

  process.stdout.write(formatReplayMarkdown(rows, inputPath));
}

async function runBenchAdapters(args: ParsedArgs): Promise<void> {
  const iterations = parsePositiveIntegerArg(args, "iterations", 5);
  const syntax = parseSyntax(stringArg(args, "syntax", "css"));
  const timeoutMs = parsePositiveIntegerArg(args, "timeout-ms", defaultTimeoutMs);
  const source = stringArg(args, "source", "a { color: red; }");
  const adapters = createDefaultAdapters();
  const rows = await benchmarkAdapters(adapters, source, { syntax, timeoutMs }, iterations);
  process.stdout.write(formatAdapterBenchmark(rows));
}

async function runVerifyCases(args: ParsedArgs): Promise<void> {
  const dir = requiredStringArg(args, "dir", "cases-dir");
  const readme = stringArg(args, "readme", path.join(path.dirname(dir), "README.md"));
  const syntax = parseSyntax(stringArg(args, "syntax", "css"));
  const timeoutMs = parsePositiveIntegerArg(args, "timeout-ms", defaultTimeoutMs);
  const minimizeAttempts = parsePositiveIntegerArg(args, "minimize-attempts", 80);
  const adapters = createDefaultAdapters();
  await assertDefaultAdaptersAvailable(adapters, { syntax, timeoutMs });
  const result = await verifyCaseRepo({
    dir,
    readme,
    syntax,
    timeoutMs,
    adapters,
    checkMinimized: parseBooleanFlagArg(args, "check-minimized"),
    minimizeAttempts,
    byteMinimize: parseBooleanFlagArg(args, "byte-minimize"),
  });
  process.stdout.write(formatCaseRepoVerification(result));
  if (!caseRepoVerificationPassed(result)) {
    process.exitCode = 1;
  }
}

function runVerifySpecCorpus(args: ParsedArgs): void {
  const corpusPath = stringArg(args, "spec-corpus", "data/specs/examples.json");
  const indexPath = optionalStringArg(args, "spec-index");
  const maxAgeHours = parsePositiveIntegerArg(
    args,
    "max-spec-corpus-age-hours",
    defaultSpecCorpusMaxAgeHours,
  );
  assertAuditableSpecCorpus(corpusPath);
  const result = verifySpecCorpus({
    path: corpusPath,
    ...(indexPath === undefined ? {} : { indexPath }),
    requireLatestIndex: true,
    maxAgeHours,
  });
  process.stdout.write(formatSpecCorpusVerification(result));
  if (!specCorpusVerificationPassed(result)) {
    process.exitCode = 1;
  }
}

function runVerifyGeneratorCoverage(args: ParsedArgs): void {
  const requireSelectedSpecs = parseBooleanFlagArg(args, "require-selected-specs");
  const seed = parseBigIntArg(args, "seed", 1n);
  const count = parsePositiveIntegerArg(args, "count", requireSelectedSpecs ? 50_000 : 10_000);
  const syntax = parseSyntax(stringArg(args, "syntax", "css"));
  const specCorpus = loadSpecCorpusFromArgs(args);
  const requiredSpecRefs = requireSelectedSpecs ? selectedSpecRefsFromArgs(args) : undefined;
  const result = verifyGeneratorCoverage({
    seed,
    count,
    syntax,
    specCorpus,
    ...(requiredSpecRefs === undefined ? {} : { requiredSpecRefs }),
  });
  process.stdout.write(formatGeneratorCoverage(result));
  if (!generatorCoveragePassed(result)) {
    process.exitCode = 1;
  }
}

async function runVerifyFindingsKnown(args: ParsedArgs): Promise<void> {
  const findingsDir = requiredStringArg(args, "findings-dir", "dir");
  const knownDir = stringArg(args, "known-dir", "../css-parser-fuzzer-cases/cases");
  const syntax = parseSyntax(stringArg(args, "syntax", "css"));
  const timeoutMs = parsePositiveIntegerArg(args, "timeout-ms", defaultTimeoutMs);
  const adapters = createDefaultAdapters();
  await assertDefaultAdaptersAvailable(adapters, { syntax, timeoutMs });
  const knownFindings = await loadKnownFindings(
    { "known-dir": knownDir },
    adapters,
    {
      syntax,
      timeoutMs,
    },
    { includePrettierFormatCrashes: true },
  );
  const result = await verifyFindingArchive({
    findingsDir,
    knownFindings,
    syntax,
    replay: { adapters, timeoutMs },
  });
  process.stdout.write(formatFindingArchiveVerification(result, findingsDir));
  if (!findingArchiveVerificationPassed(result)) {
    process.exitCode = 1;
  }
}

async function runVerifyLightningRoundTrip(args: ParsedArgs): Promise<void> {
  const seed = parseBigIntArg(args, "seed", 1n);
  const count = parsePositiveIntegerArg(args, "count", 1_000);
  const syntax = parseSyntax(stringArg(args, "syntax", "css"));
  const timeoutMs = parsePositiveIntegerArg(args, "timeout-ms", defaultTimeoutMs);
  const specCorpus = loadSpecCorpusFromArgs(args);
  const specCorpusPath = specCorpusPathFromArgs(args);
  const knownDir = stringArg(args, "known-dir", "");
  const outDir = stringArg(args, "out", "");
  const minimize = parseBooleanFlagArg(args, "minimize");
  const minimizeAttempts = parsePositiveIntegerArg(args, "minimize-attempts", 80);
  const byteMinimize = parseBooleanFlagArg(args, "byte-minimize");
  const adapters = createDefaultAdapters();
  await assertDefaultAdaptersAvailable(adapters, { syntax, timeoutMs });
  const knownFindings = await loadKnownFindings(
    args,
    adapters,
    { syntax, timeoutMs },
    { includePrettierFormatCrashes: true },
  );
  if (knownDir !== "") {
    process.stderr.write(
      `Loaded ${knownFindings.fingerprints.size} known source fingerprints and ${knownFindings.families.size} known issue families.\n`,
    );
  }
  const result = await verifyLightningRoundTrip({
    adapters,
    seed,
    count,
    syntax,
    timeoutMs,
    knownFindings,
    specCorpus,
  });
  process.stdout.write(formatLightningRoundTrip(result));
  const reportContext = {
    outDir,
    seed: seed.toString(),
    count,
    syntax,
    timeoutMs,
    knownDir,
    minimize,
    minimizeAttempts,
    byteMinimize,
    adapters,
    ...(specCorpusPath === undefined ? {} : { specCorpusPath }),
  };
  const writtenFindings = await writeLightningRoundTripReports(result, reportContext);
  await writeRoundTripCommandSummary(reportContext, result, writtenFindings, {
    command: "verify-lightning-roundtrip",
  });
  if (!lightningRoundTripPassed(result)) {
    process.exitCode = 1;
  }
}

async function runVerifyPrettierRoundTrip(args: ParsedArgs): Promise<void> {
  const seed = parseBigIntArg(args, "seed", 1n);
  const count = parsePositiveIntegerArg(args, "count", 1_000);
  const syntax = parseSyntax(stringArg(args, "syntax", "css"));
  const timeoutMs = parsePositiveIntegerArg(args, "timeout-ms", defaultTimeoutMs);
  const specCorpus = loadSpecCorpusFromArgs(args);
  const specCorpusPath = specCorpusPathFromArgs(args);
  const knownDir = stringArg(args, "known-dir", "");
  const outDir = stringArg(args, "out", "");
  const minimize = parseBooleanFlagArg(args, "minimize");
  const minimizeAttempts = parsePositiveIntegerArg(args, "minimize-attempts", 80);
  const byteMinimize = parseBooleanFlagArg(args, "byte-minimize");
  const adapters = createDefaultAdapters();
  await assertDefaultAdaptersAvailable(adapters, { syntax, timeoutMs });
  const knownFindings = await loadKnownFindings(
    args,
    adapters,
    { syntax, timeoutMs },
    { includePrettierFormatCrashes: true },
  );
  if (knownDir !== "") {
    process.stderr.write(
      `Loaded ${knownFindings.fingerprints.size} known source fingerprints and ${knownFindings.families.size} known issue families.\n`,
    );
  }
  const result = await verifyPrettierRoundTrip({
    adapters,
    seed,
    count,
    syntax,
    timeoutMs,
    knownFindings,
    specCorpus,
  });
  process.stdout.write(formatPrettierRoundTrip(result));
  const reportContext = {
    outDir,
    seed: seed.toString(),
    count,
    syntax,
    timeoutMs,
    knownDir,
    minimize,
    minimizeAttempts,
    byteMinimize,
    adapters,
    ...(specCorpusPath === undefined ? {} : { specCorpusPath }),
  };
  const writtenFindings = await writePrettierRoundTripReports(result, reportContext);
  await writeRoundTripCommandSummary(reportContext, result, writtenFindings, {
    command: "verify-prettier-roundtrip",
  });
  if (!prettierRoundTripPassed(result)) {
    process.exitCode = 1;
  }
}

interface RoundTripReportContext {
  readonly outDir: string;
  readonly seed: string;
  readonly count: number;
  readonly syntax: CssSyntax;
  readonly timeoutMs: number;
  readonly specCorpusPath?: string;
  readonly knownDir: string;
  readonly minimize: boolean;
  readonly minimizeAttempts: number;
  readonly byteMinimize: boolean;
  readonly adapters: ReturnType<typeof createDefaultAdapters>;
}

interface WritableRoundTripMismatch {
  readonly originalCase: FuzzCase;
  readonly outputCase: FuzzCase;
  readonly originalResults: readonly ParseResult[];
  readonly outputResults: readonly ParseResult[];
  readonly reason: string;
}

async function writeLightningRoundTripReports(
  result: LightningRoundTripResult,
  context: RoundTripReportContext,
): Promise<readonly WrittenFindingPaths[]> {
  return await writeRoundTripReports(result.mismatches.map(lightningWritableMismatch), {
    ...context,
    command: "verify-lightning-roundtrip",
    oracle: "lightning-roundtrip",
  });
}

async function writePrettierRoundTripReports(
  result: PrettierRoundTripResult,
  context: RoundTripReportContext,
): Promise<readonly WrittenFindingPaths[]> {
  const writableMismatches: WritableRoundTripMismatch[] = [];
  const formatterCrashes: PrettierRoundTripResult["mismatches"][number][] = [];
  for (const mismatch of result.mismatches) {
    if (mismatch.formattedCase === undefined || mismatch.roundTripResults === undefined) {
      formatterCrashes.push(mismatch);
      continue;
    }
    writableMismatches.push({
      originalCase: mismatch.originalCase,
      outputCase: mismatch.formattedCase,
      originalResults: mismatch.originalResults,
      outputResults: mismatch.roundTripResults,
      reason: mismatch.reason,
    });
  }

  const writtenRoundTripFindings = await writeRoundTripReports(writableMismatches, {
    ...context,
    command: "verify-prettier-roundtrip",
    oracle: "prettier-roundtrip",
  });
  const writtenFormatterCrashFindings = await writePrettierFormatCrashReports(
    formatterCrashes,
    context,
  );
  return [...writtenRoundTripFindings, ...writtenFormatterCrashFindings];
}

async function writePrettierFormatCrashReports(
  mismatches: readonly PrettierRoundTripResult["mismatches"][number][],
  context: RoundTripReportContext,
): Promise<readonly WrittenFindingPaths[]> {
  if (context.outDir === "" || mismatches.length === 0) {
    return [];
  }

  const environment = collectEnvironment(
    context.specCorpusPath === undefined ? {} : { specCorpusPath: context.specCorpusPath },
  );
  const run = roundTripRunReport(context, "verify-prettier-roundtrip");
  const writtenFindings: WrittenFindingPaths[] = [];
  for (const mismatch of mismatches) {
    const formatterErrorMessage =
      mismatch.formatterErrorMessage ?? "unknown Prettier formatter failure";
    const finding = prettierFormatCrashFinding(
      mismatch.originalCase,
      mismatch.originalResults,
      formatterErrorMessage,
    );
    let output: DifferentialFinding | MinimizedFinding = finding;
    if (context.minimize) {
      const minimized = await minimizePrettierFormatCrashFinding(finding, formatterErrorMessage, {
        adapters: context.adapters,
        syntax: context.syntax,
        timeoutMs: context.timeoutMs,
        maxAttempts: context.minimizeAttempts,
        allowByteLevel: context.byteMinimize,
      });
      output = reportableFinding(finding, minimized);
      if (output !== minimized) {
        process.stderr.write(
          `[warn] Discarded unstable minimized Prettier formatter crash output for ${finding.testCase.id}; writing the original finding.\n`,
        );
      }
    }
    const paths = await writeFinding(context.outDir, output, {
      environment,
      run,
      roundTrip: {
        oracle: "prettier-format-crash",
        originalCase: mismatch.originalCase,
        originalResults: mismatch.originalResults,
      },
    });
    writtenFindings.push(paths);
    process.stdout.write(`  wrote ${paths.cssPath} and ${paths.jsonPath}\n`);
  }
  return writtenFindings;
}

async function writeRoundTripReports(
  mismatches: readonly WritableRoundTripMismatch[],
  context: RoundTripReportContext & {
    readonly command: RoundTripRunReport["command"];
    readonly oracle: "lightning-roundtrip" | "prettier-roundtrip";
  },
): Promise<readonly WrittenFindingPaths[]> {
  if (context.outDir === "" || mismatches.length === 0) {
    return [];
  }

  const environment = collectEnvironment(
    context.specCorpusPath === undefined ? {} : { specCorpusPath: context.specCorpusPath },
  );
  const run = roundTripRunReport(context, context.command);
  const writtenFindings: WrittenFindingPaths[] = [];

  for (const mismatch of mismatches) {
    const finding: DifferentialFinding = {
      testCase: mismatch.outputCase,
      results: mismatch.outputResults,
      interesting: true,
      reason: mismatch.reason,
    };
    let output: DifferentialFinding | MinimizedFinding = finding;
    if (context.minimize) {
      const minimized = await minimizeRoundTripFinding(finding, context);
      output = reportableFinding(finding, minimized);
      if (output !== minimized) {
        process.stderr.write(
          `[warn] Discarded unstable minimized roundtrip output for ${finding.testCase.id}; writing the original finding.\n`,
        );
      }
    }
    const paths = await writeFinding(context.outDir, output, {
      environment,
      run,
      roundTrip: {
        oracle: context.oracle,
        originalCase: mismatch.originalCase,
        originalResults: mismatch.originalResults,
      },
    });
    writtenFindings.push(paths);
    process.stdout.write(`  wrote ${paths.cssPath} and ${paths.jsonPath}\n`);
  }
  return writtenFindings;
}

function roundTripRunReport(
  context: RoundTripReportContext,
  command: RoundTripRunReport["command"],
): RoundTripRunReport {
  return {
    command,
    seed: context.seed,
    count: context.count,
    syntax: context.syntax,
    timeoutMs: context.timeoutMs,
    minimize: context.minimize,
    minimizeAttempts: context.minimizeAttempts,
    byteMinimize: context.byteMinimize,
    outDir: context.outDir,
    ...(context.specCorpusPath === undefined ? {} : { specCorpusPath: context.specCorpusPath }),
    ...(context.knownDir === "" ? {} : { knownDir: context.knownDir }),
  };
}

async function writeRoundTripCommandSummary(
  context: RoundTripReportContext,
  result: LightningRoundTripResult | PrettierRoundTripResult,
  findings: readonly WrittenFindingPaths[],
  options: { readonly command: RoundTripRunReport["command"] },
): Promise<void> {
  if (context.outDir === "") {
    return;
  }
  const environment = collectEnvironment(
    context.specCorpusPath === undefined ? {} : { specCorpusPath: context.specCorpusPath },
  );
  const summaryPath = await writeRoundTripSummary(context.outDir, {
    completedAt: new Date().toISOString(),
    environment,
    run: roundTripRunReport(context, options.command),
    counts: roundTripSummaryCounts(result, findings.length),
    findings,
  });
  process.stdout.write(`Wrote roundtrip summary: ${summaryPath}\n`);
}

function roundTripSummaryCounts(
  result: LightningRoundTripResult | PrettierRoundTripResult,
  writtenFindings: number,
): RoundTripSummaryCounts {
  return {
    generatedCases: result.generatedCases,
    checkedOutputs: result.checkedOutputs,
    knownSkipped: result.knownSkipped,
    duplicateSkipped: result.duplicateSkipped,
    mismatches: result.mismatches.length,
    writtenFindings,
    skippedUnchangedOutputs: result.skippedUnchangedOutputs,
    ...("skippedRejectedInputs" in result
      ? {
          skippedRejectedInputs: result.skippedRejectedInputs,
          skippedMissingOutputs: result.skippedMissingOutputs,
        }
      : {
          skippedInterestingInputs: result.skippedInterestingInputs,
          skippedPrettierRejectedInputs: result.skippedPrettierRejectedInputs,
        }),
  };
}

async function minimizeRoundTripFinding(
  finding: DifferentialFinding,
  context: RoundTripReportContext,
): Promise<MinimizedFinding> {
  const minimized = await minimizeText(
    finding.testCase.source,
    async (candidate) => {
      const candidateFinding = await runDifferentialCase(
        context.adapters,
        { ...finding.testCase, source: candidate },
        { syntax: context.syntax, timeoutMs: context.timeoutMs },
      );
      return (
        candidateFinding.interesting &&
        preservesFindingIdentity(
          finding.testCase.source,
          finding.results,
          candidate,
          candidateFinding.results,
        )
      );
    },
    { maxAttempts: context.minimizeAttempts, allowByteLevel: context.byteMinimize },
  );
  const replay = await runDifferentialCase(
    context.adapters,
    { ...finding.testCase, source: minimized.source },
    { syntax: context.syntax, timeoutMs: context.timeoutMs },
  );
  return {
    original: finding,
    minimizedSource: minimized.source,
    minimizedResults: replay.results,
    attempts: minimized.attempts,
  };
}

function lightningWritableMismatch(
  mismatch: LightningRoundTripResult["mismatches"][number],
): WritableRoundTripMismatch {
  return {
    originalCase: mismatch.originalCase,
    outputCase: mismatch.transformedCase,
    originalResults: mismatch.originalResults,
    outputResults: mismatch.roundTripResults,
    reason: mismatch.reason,
  };
}

async function runReduce(args: ParsedArgs): Promise<void> {
  const file = stringArg(args, "file", "");
  if (file === "") {
    throw new Error("reduce requires --file path/to/input.css");
  }
  const syntax = parseSyntax(stringArg(args, "syntax", "css"));
  const timeoutMs = parsePositiveIntegerArg(args, "timeout-ms", defaultTimeoutMs);
  const maxAttempts = parsePositiveIntegerArg(args, "minimize-attempts", 200);
  const source = await readFile(file, "utf8");
  const adapters = createDefaultAdapters();
  await assertDefaultAdaptersAvailable(adapters, { syntax, timeoutMs });
  const finding = await runDifferentialCase(
    adapters,
    {
      id: path.basename(file, ".css"),
      seed: file,
      syntax,
      source,
      tags: ["reduce"],
      specRefs: [],
    },
    { syntax, timeoutMs },
  );
  if (!finding.interesting) {
    process.stdout.write(`Input is not interesting: ${formatResults(finding.results)}\n`);
    return;
  }

  const minimized = await minimizeText(
    source,
    async (candidate) => {
      const candidateFinding = await runDifferentialCase(
        adapters,
        { ...finding.testCase, source: candidate },
        { syntax, timeoutMs },
      );
      return (
        candidateFinding.interesting &&
        preservesFindingIdentity(source, finding.results, candidate, candidateFinding.results)
      );
    },
    { maxAttempts, allowByteLevel: parseBooleanFlagArg(args, "byte-minimize") },
  );
  const replay = await runDifferentialCase(
    adapters,
    { ...finding.testCase, source: minimized.source },
    { syntax, timeoutMs },
  );
  const out = stringArg(args, "out", "");
  if (out === "") {
    process.stdout.write(`${minimized.source.trimEnd()}\n`);
  } else {
    await writeFile(out, `${minimized.source.trimEnd()}\n`, "utf8");
  }
  process.stderr.write(`Reduced ${file} in ${minimized.attempts} attempts.\n`);
  process.stderr.write(`  ${formatResults(replay.results)}\n`);
}

function loadSpecCorpusFromArgs(args: ParsedArgs) {
  const corpusPath = specCorpusPathFromArgs(args);
  if (corpusPath === undefined) {
    return [];
  }
  if (!existsSync(corpusPath)) {
    throw new Error(
      `Spec corpus not found at ${corpusPath}. Run "vp run fetch-specs -- --download" first, pass --spec-corpus path/to/examples.json, or pass --no-spec-corpus intentionally.`,
    );
  }
  const maxAgeHours = parsePositiveIntegerArg(
    args,
    "max-spec-corpus-age-hours",
    defaultSpecCorpusMaxAgeHours,
  );
  assertAuditableSpecCorpus(corpusPath, { maxAgeHours });
  const maxExamples = parseOptionalPositiveIntegerArg(args, "max-spec-examples");
  return loadSpecCorpus({
    path: corpusPath,
    ...(maxExamples === undefined ? {} : { maxExamples }),
  });
}

function specCorpusPathFromArgs(args: ParsedArgs): string | undefined {
  if (parseBooleanFlagArg(args, "no-spec-corpus")) {
    return undefined;
  }
  return stringArg(args, "spec-corpus", "data/specs/examples.json");
}

function selectedSpecRefsFromArgs(args: ParsedArgs): readonly string[] {
  const corpusPath = specCorpusPathFromArgs(args);
  if (corpusPath === undefined) {
    throw new Error(
      "--require-selected-specs requires a spec corpus. Remove --no-spec-corpus or pass --spec-corpus path/to/examples.json.",
    );
  }
  return readSpecCorpusAudit(corpusPath).selectedSlugs;
}

async function loadKnownFindings(
  args: ParsedArgs,
  adapters: ReturnType<typeof createDefaultAdapters>,
  options: { readonly syntax: CssSyntax; readonly timeoutMs: number },
  extras: { readonly includePrettierFormatCrashes?: boolean } = {},
): Promise<KnownFindingFingerprints> {
  const knownDir = stringArg(args, "known-dir", "");
  if (knownDir === "") {
    return { fingerprints: new Set(), families: new Set() };
  }
  const files = await collectCssFiles(knownDir);
  const rows = await replayCssFiles(files, adapters, options);
  const parserKnownFindings = knownFindingsFromReplayRows(rows, options.syntax);
  if (extras.includePrettierFormatCrashes !== true) {
    return parserKnownFindings;
  }
  const prettierFormatCrashRows = await prettierFormatCrashRowsFromReplayRows(rows, options.syntax);
  return mergeKnownFindings(
    parserKnownFindings,
    knownFindingsFromReplayRows(prettierFormatCrashRows, options.syntax),
  );
}

async function assertDefaultAdaptersAvailable(
  adapters: ReturnType<typeof createDefaultAdapters>,
  context: { readonly syntax: CssSyntax; readonly timeoutMs: number },
): Promise<void> {
  assertRequiredAdaptersAvailable(await verifyRequiredAdapters(adapters, context));
}

main(process.argv.slice(2))
  .catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    closeJsParserWorkers();
  });
