import { describe, expect, test } from "vite-plus/test";
import type { ParserAdapter, ParseResult } from "../src/core/types.js";
import {
  formatLightningRoundTrip,
  lightningRoundTripPassed,
  verifyLightningRoundTrip,
} from "../src/runner/lightningRoundTrip.js";
import { findingSourceFingerprint } from "../src/runner/differential.js";

describe("lightningcss output roundtrip verification", () => {
  test("passes when transformed output is accepted by every adapter", async () => {
    const result = await verifyLightningRoundTrip({
      adapters: roundTripAdapters({ rejectTransformedWithPostcss: false }),
      seed: 1n,
      count: 3,
      syntax: "css",
      timeoutMs: 1_000,
      specCorpus: [],
    });

    expect(lightningRoundTripPassed(result)).toBe(true);
    expect(result.checkedOutputs).toBe(3);
    expect(result.mismatches).toEqual([]);
    expect(formatLightningRoundTrip(result)).toContain(
      "Lightning output roundtrip verification passed.",
    );
  });

  test("fails when lightningcss transformed output does not replay cleanly", async () => {
    const result = await verifyLightningRoundTrip({
      adapters: roundTripAdapters({ rejectTransformedWithPostcss: true }),
      seed: 1n,
      count: 1,
      syntax: "css",
      timeoutMs: 1_000,
      specCorpus: [],
    });

    expect(lightningRoundTripPassed(result)).toBe(false);
    expect(result.checkedOutputs).toBe(1);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]?.roundTripResults).toContainEqual(
      expect.objectContaining({ parser: "postcss", status: "rejected" }),
    );
    expect(formatLightningRoundTrip(result)).toContain(
      "Lightning output roundtrip verification failed.",
    );
  });

  test("skips known transformed-output mismatches", async () => {
    const transformedSource = ":root { --from-lightning: 1; }\n";
    const transformedResults = [
      { parser: "postcss", status: "rejected", durationMs: 1 },
      { parser: "prettier-css", status: "accepted", durationMs: 1 },
      { parser: "lightningcss", status: "accepted", durationMs: 1 },
      { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
    ] satisfies readonly ParseResult[];
    const result = await verifyLightningRoundTrip({
      adapters: roundTripAdapters({ rejectTransformedWithPostcss: true }),
      seed: 1n,
      count: 1,
      syntax: "css",
      timeoutMs: 1_000,
      knownFindings: {
        fingerprints: new Set([findingSourceFingerprint(transformedSource, transformedResults)]),
        families: new Set(),
      },
      specCorpus: [],
    });

    expect(lightningRoundTripPassed(result)).toBe(true);
    expect(result.knownSkipped).toBe(1);
    expect(result.mismatches).toEqual([]);
  });
});

function roundTripAdapters(options: {
  readonly rejectTransformedWithPostcss: boolean;
}): readonly ParserAdapter[] {
  return [
    {
      name: "postcss",
      parse: async (source) =>
        result(
          "postcss",
          source.includes("--from-lightning") && options.rejectTransformedWithPostcss
            ? "rejected"
            : "accepted",
        ),
    },
    {
      name: "prettier-css",
      parse: async () => result("prettier-css", "accepted"),
    },
    {
      name: "lightningcss",
      parse: async (source) =>
        result("lightningcss", "accepted", {
          transformedSource: source.includes("--from-lightning")
            ? source
            : ":root { --from-lightning: 1; }\n",
        }),
    },
    {
      name: "oxc-css-parser",
      parse: async () => result("oxc-css-parser", "accepted"),
    },
  ];
}

function result(
  parser: ParseResult["parser"],
  status: ParseResult["status"],
  detail?: ParseResult["detail"],
): ParseResult {
  return { parser, status, durationMs: 1, ...(detail === undefined ? {} : { detail }) };
}
