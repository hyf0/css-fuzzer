import { describe, expect, test } from "vite-plus/test";
import type { DifferentialFinding, MinimizedFinding, ParseResult } from "../src/core/types.js";
import { minimizedFindingStable, reportableFinding } from "../src/runner/minimizedFinding.js";

const interestingResults = [
  { parser: "postcss", status: "accepted", durationMs: 1 },
  { parser: "lightningcss", status: "rejected", durationMs: 1, message: "bad" },
] satisfies readonly ParseResult[];

const original: DifferentialFinding = {
  testCase: {
    id: "case",
    seed: "1",
    syntax: "css",
    source: ".before { color: blue; }\n.target { color: red; }",
    tags: ["test"],
    specRefs: ["css-syntax-3"],
  },
  results: interestingResults,
  interesting: true,
  reason: "Parser status disagreement.",
};

describe("minimized finding stability", () => {
  test("keeps a minimized finding with the same interesting identity", () => {
    const minimized: MinimizedFinding = {
      original,
      minimizedSource: ".target { color: red; }",
      minimizedResults: interestingResults,
      attempts: 4,
    };

    expect(minimizedFindingStable(minimized)).toBe(true);
    expect(reportableFinding(original, minimized)).toBe(minimized);
  });

  test("falls back to the original finding when minimized replay is no longer interesting", () => {
    const minimized: MinimizedFinding = {
      original,
      minimizedSource: ".target { color: red; }",
      minimizedResults: [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "lightningcss", status: "accepted", durationMs: 1 },
      ],
      attempts: 4,
    };

    expect(minimizedFindingStable(minimized)).toBe(false);
    expect(reportableFinding(original, minimized)).toBe(original);
  });

  test("falls back to the original finding when minimized replay changes fingerprint", () => {
    const minimized: MinimizedFinding = {
      original,
      minimizedSource: ".target { color: red; }",
      minimizedResults: [
        { parser: "postcss", status: "accepted", durationMs: 1 },
        { parser: "lightningcss", status: "rejected", durationMs: 1, message: "different" },
      ],
      attempts: 4,
    };

    expect(minimizedFindingStable(minimized)).toBe(false);
    expect(reportableFinding(original, minimized)).toBe(original);
  });
});
