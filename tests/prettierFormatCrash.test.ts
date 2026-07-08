import { describe, expect, test } from "vite-plus/test";
import type { ParserAdapter, ParseResult } from "../src/core/types.js";
import {
  currentPrettierFormatCrashFinding,
  minimizePrettierFormatCrashFinding,
  prettierFormatCrashFinding,
  prettierFormatCrashRowsFromReplayRows,
  type CssFormatter,
} from "../src/runner/prettierFormatCrash.js";

const parserResults: readonly ParseResult[] = [
  { parser: "postcss", status: "accepted", durationMs: 1 },
  { parser: "prettier-css", status: "accepted", durationMs: 1 },
  { parser: "lightningcss", status: "accepted", durationMs: 1 },
  { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
];

describe("Prettier formatter crash reports", () => {
  test("represents a formatter crash as a replayable finding", () => {
    const finding = prettierFormatCrashFinding(
      testCase(":root { --boom: 1; }"),
      parserResults,
      "boom",
    );

    expect(finding.testCase.id).toBe("case-prettier-format-crash");
    expect(finding.results).toContainEqual(
      expect.objectContaining({
        parser: "prettier-css",
        status: "crashed",
        message: "formatter: boom",
      }),
    );
    expect(finding.reason).toContain("boom");
  });

  test("minimizes a formatter crash while preserving the crash message", async () => {
    const formatter: CssFormatter = async (source) => {
      if (source.includes("--boom")) {
        throw new Error("boom");
      }
      return source;
    };
    const finding = prettierFormatCrashFinding(
      testCase(":root { color: red; --boom: 1; background: blue; }"),
      parserResults,
      "boom",
    );

    const minimized = await minimizePrettierFormatCrashFinding(finding, "boom", {
      adapters: allAcceptedAdapters(),
      syntax: "css",
      timeoutMs: 1_000,
      maxAttempts: 80,
      allowByteLevel: false,
      formatter,
    });

    expect(minimized.minimizedSource.length).toBeLessThan(finding.testCase.source.length);
    expect(minimized.minimizedSource).toContain("--boom");
    expect(minimized.minimizedResults).toContainEqual(
      expect.objectContaining({
        parser: "prettier-css",
        status: "crashed",
        message: "formatter: boom",
      }),
    );
  });

  test("rechecks formatter crashes against the current formatter", async () => {
    const formatter: CssFormatter = async (source) => {
      if (source.includes("--boom")) {
        throw new Error("boom");
      }
      return source;
    };

    const finding = await currentPrettierFormatCrashFinding(
      testCase(":root { --boom: 1; }"),
      allAcceptedAdapters(),
      { syntax: "css", timeoutMs: 1_000, formatter },
    );

    expect(finding.interesting).toBe(true);
    expect(finding.results).toContainEqual(
      expect.objectContaining({ parser: "prettier-css", status: "crashed" }),
    );
  });

  test("derives known formatter crash rows from parser replay rows", async () => {
    const formatter: CssFormatter = async (source) => {
      if (source.includes("--boom")) {
        throw new Error("boom");
      }
      return source;
    };

    const rows = await prettierFormatCrashRowsFromReplayRows(
      [
        {
          file: "known.css",
          source: ":root { --boom: 1; }",
          results: parserResults,
        },
      ],
      "css",
      formatter,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.results).toContainEqual(
      expect.objectContaining({
        parser: "prettier-css",
        status: "crashed",
        message: "formatter: boom",
      }),
    );
  });
});

function testCase(source: string) {
  return {
    id: "case",
    seed: "case",
    syntax: "css" as const,
    source,
    tags: ["test"],
    specRefs: ["css-syntax-3"],
  };
}

function allAcceptedAdapters(): readonly ParserAdapter[] {
  return parserResults.map((item) => ({
    name: item.parser,
    parse: async () => item,
  }));
}
