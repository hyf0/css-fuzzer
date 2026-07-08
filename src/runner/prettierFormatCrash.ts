import * as prettier from "prettier";
import type {
  CssSyntax,
  DifferentialFinding,
  FuzzCase,
  MinimizedFinding,
  ParserAdapter,
  ParseResult,
} from "../core/types.js";
import { classifyFinding, runDifferentialCase } from "./differential.js";
import type { KnownFindingReplayRow } from "./findingDedup.js";
import { minimizeText } from "./shrink.js";

export type CssFormatter = (source: string) => Promise<string>;

export interface PrettierFormatCrashMinimizeOptions {
  readonly adapters: readonly ParserAdapter[];
  readonly syntax: CssSyntax;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly allowByteLevel: boolean;
  readonly formatter?: CssFormatter;
}

export function prettierFormatCrashFinding(
  testCase: FuzzCase,
  parserResults: readonly ParseResult[],
  formatterErrorMessage: string,
): DifferentialFinding {
  return {
    testCase: {
      ...testCase,
      id: testCase.id.endsWith("-prettier-format-crash")
        ? testCase.id
        : `${testCase.id}-prettier-format-crash`,
      tags: testCase.tags.includes("prettier-format-crash")
        ? testCase.tags
        : [...testCase.tags, "prettier-format-crash"],
    },
    results: parserResults.map((result) =>
      result.parser === "prettier-css"
        ? {
            parser: result.parser,
            status: "crashed",
            durationMs: result.durationMs,
            message: `formatter: ${formatterErrorMessage}`,
            detail: { parserStatus: result.status },
          }
        : result,
    ),
    interesting: true,
    reason: `Prettier formatter crashed after parser accepted: ${formatterErrorMessage}`,
  };
}

export async function minimizePrettierFormatCrashFinding(
  finding: DifferentialFinding,
  formatterErrorMessage: string,
  options: PrettierFormatCrashMinimizeOptions,
): Promise<MinimizedFinding> {
  const formatter = options.formatter ?? formatCssWithPrettier;
  const minimized = await minimizeText(
    finding.testCase.source,
    async (candidate) =>
      await isPrettierFormatCrashCandidate(candidate, formatterErrorMessage, {
        ...options,
        formatter,
      }),
    { maxAttempts: options.maxAttempts, allowByteLevel: options.allowByteLevel },
  );
  const replay = await runDifferentialCase(
    options.adapters,
    { ...finding.testCase, source: minimized.source },
    { syntax: options.syntax, timeoutMs: options.timeoutMs },
  );
  const currentFormatterError = await currentPrettierFormatError(minimized.source, formatter);
  return {
    original: finding,
    minimizedSource: minimized.source,
    minimizedResults: prettierFormatCrashFinding(
      { ...finding.testCase, source: minimized.source },
      replay.results,
      currentFormatterError ?? formatterErrorMessage,
    ).results,
    attempts: minimized.attempts,
  };
}

export async function currentPrettierFormatCrashFinding(
  testCase: FuzzCase,
  adapters: readonly ParserAdapter[],
  context: {
    readonly syntax: CssSyntax;
    readonly timeoutMs: number;
    readonly formatter?: CssFormatter;
  },
): Promise<DifferentialFinding> {
  const parserFinding = await runDifferentialCase(adapters, testCase, context);
  if (parserFinding.interesting) {
    return parserFinding;
  }
  const prettierResult = parserFinding.results.find((result) => result.parser === "prettier-css");
  if (prettierResult?.status !== "accepted") {
    return parserFinding;
  }
  const formatterError = await currentPrettierFormatError(
    testCase.source,
    context.formatter ?? formatCssWithPrettier,
  );
  return formatterError === undefined
    ? parserFinding
    : prettierFormatCrashFinding(testCase, parserFinding.results, formatterError);
}

export async function prettierFormatCrashRowsFromReplayRows(
  rows: readonly KnownFindingReplayRow[],
  syntax: CssSyntax,
  formatter: CssFormatter = formatCssWithPrettier,
): Promise<readonly KnownFindingReplayRow[]> {
  const crashRows: KnownFindingReplayRow[] = [];
  for (const row of rows) {
    const parserFinding = classifyFinding(
      {
        id: row.file,
        seed: row.file,
        syntax,
        source: row.source,
        tags: ["known-dir"],
        specRefs: [],
      },
      row.results,
    );
    if (parserFinding.interesting) {
      continue;
    }
    const prettierResult = row.results.find((result) => result.parser === "prettier-css");
    if (prettierResult?.status !== "accepted") {
      continue;
    }
    const formatterError = await currentPrettierFormatError(row.source, formatter);
    if (formatterError === undefined) {
      continue;
    }
    crashRows.push({
      file: row.file,
      source: row.source,
      results: prettierFormatCrashFinding(
        {
          id: row.file,
          seed: row.file,
          syntax,
          source: row.source,
          tags: ["known-dir", "prettier-format-crash"],
          specRefs: [],
        },
        row.results,
        formatterError,
      ).results,
    });
  }
  return crashRows;
}

export async function formatCssWithPrettier(source: string): Promise<string> {
  return await prettier.format(source, { parser: "css" });
}

async function isPrettierFormatCrashCandidate(
  source: string,
  formatterErrorMessage: string,
  options: PrettierFormatCrashMinimizeOptions & { readonly formatter: CssFormatter },
): Promise<boolean> {
  const parserFinding = await runDifferentialCase(
    options.adapters,
    {
      id: "prettier-format-crash-candidate",
      seed: "prettier-format-crash-candidate",
      syntax: options.syntax,
      source,
      tags: ["prettier-format-crash"],
      specRefs: [],
    },
    { syntax: options.syntax, timeoutMs: options.timeoutMs },
  );
  if (parserFinding.interesting) {
    return false;
  }
  const prettierResult = parserFinding.results.find((result) => result.parser === "prettier-css");
  if (prettierResult?.status !== "accepted") {
    return false;
  }
  const formatterError = await currentPrettierFormatError(source, options.formatter);
  return formatterError === firstLine(formatterErrorMessage);
}

async function currentPrettierFormatError(
  source: string,
  formatter: CssFormatter,
): Promise<string | undefined> {
  try {
    await formatter(source);
    return undefined;
  } catch (error) {
    return firstLine(error instanceof Error ? error.message : String(error));
  }
}

function firstLine(value: string): string {
  return value.split("\n")[0] ?? value;
}
