import { describe, expect, test } from "vite-plus/test";
import type { ParserAdapter, ParseResult } from "../src/core/types.js";
import { generateCase } from "../src/generator/generator.js";
import { findingSourceFingerprint } from "../src/runner/differential.js";
import { prettierFormatCrashFinding } from "../src/runner/prettierFormatCrash.js";
import {
  formatPrettierRoundTrip,
  prettierRoundTripPassed,
  verifyPrettierRoundTrip,
} from "../src/runner/prettierRoundTrip.js";

describe("Prettier format roundtrip verification", () => {
  test("passes when formatted output is accepted by every adapter", async () => {
    const result = await verifyPrettierRoundTrip({
      adapters: roundTripAdapters({ rejectFormattedWithOxc: false }),
      seed: 1n,
      count: 3,
      syntax: "css",
      timeoutMs: 1_000,
      formatter: async () => ":root { --from-prettier: 1; }\n",
      specCorpus: [],
    });

    expect(prettierRoundTripPassed(result)).toBe(true);
    expect(result.checkedOutputs).toBe(3);
    expect(result.mismatches).toEqual([]);
    expect(formatPrettierRoundTrip(result)).toContain(
      "Prettier format roundtrip verification passed.",
    );
  });

  test("fails when formatted output does not replay cleanly", async () => {
    const result = await verifyPrettierRoundTrip({
      adapters: roundTripAdapters({ rejectFormattedWithOxc: true }),
      seed: 1n,
      count: 1,
      syntax: "css",
      timeoutMs: 1_000,
      formatter: async () => ":root { --from-prettier: 1; }\n",
      specCorpus: [],
    });

    expect(prettierRoundTripPassed(result)).toBe(false);
    expect(result.checkedOutputs).toBe(1);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]?.roundTripResults).toContainEqual(
      expect.objectContaining({ parser: "oxc-css-parser", status: "rejected" }),
    );
    expect(formatPrettierRoundTrip(result)).toContain(
      "Prettier format roundtrip verification failed.",
    );
  });

  test("fails when formatting crashes after the Prettier parser accepted", async () => {
    const result = await verifyPrettierRoundTrip({
      adapters: roundTripAdapters({ rejectFormattedWithOxc: false }),
      seed: 1n,
      count: 1,
      syntax: "css",
      timeoutMs: 1_000,
      formatter: async () => {
        throw new Error("format boom");
      },
      specCorpus: [],
    });

    expect(prettierRoundTripPassed(result)).toBe(false);
    expect(result.checkedOutputs).toBe(0);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]?.reason).toContain("format boom");
    expect(result.mismatches[0]?.formatterErrorMessage).toBe("format boom");
  });

  test("skips known formatter crashes", async () => {
    const originalCase = generateCase(1n, { syntax: "css", specCorpus: [] });
    const crashFinding = prettierFormatCrashFinding(
      originalCase,
      allAcceptedResults,
      "format boom",
    );

    const result = await verifyPrettierRoundTrip({
      adapters: roundTripAdapters({ rejectFormattedWithOxc: false }),
      seed: 1n,
      count: 1,
      syntax: "css",
      timeoutMs: 1_000,
      formatter: async () => {
        throw new Error("format boom");
      },
      knownFindings: {
        fingerprints: new Set([
          findingSourceFingerprint(crashFinding.testCase.source, crashFinding.results),
        ]),
        families: new Set(),
      },
      specCorpus: [],
    });

    expect(prettierRoundTripPassed(result)).toBe(true);
    expect(result.knownSkipped).toBe(1);
    expect(result.mismatches).toEqual([]);
  });
});

const allAcceptedResults: readonly ParseResult[] = [
  { parser: "postcss", status: "accepted", durationMs: 1 },
  { parser: "prettier-css", status: "accepted", durationMs: 1 },
  { parser: "lightningcss", status: "accepted", durationMs: 1 },
  { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
];

function roundTripAdapters(options: {
  readonly rejectFormattedWithOxc: boolean;
}): readonly ParserAdapter[] {
  return [
    {
      name: "postcss",
      parse: async () => result("postcss", "accepted"),
    },
    {
      name: "prettier-css",
      parse: async () => result("prettier-css", "accepted"),
    },
    {
      name: "lightningcss",
      parse: async () => result("lightningcss", "accepted"),
    },
    {
      name: "oxc-css-parser",
      parse: async (source) =>
        result(
          "oxc-css-parser",
          source.includes("--from-prettier") && options.rejectFormattedWithOxc
            ? "rejected"
            : "accepted",
        ),
    },
  ];
}

function result(parser: ParseResult["parser"], status: ParseResult["status"]): ParseResult {
  return { parser, status, durationMs: 1 };
}
