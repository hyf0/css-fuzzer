import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import type {
  DifferentialFinding,
  MinimizedFinding,
  ParserAdapter,
  ParseResult,
} from "../src/core/types.js";
import { findingSourceFingerprint } from "../src/runner/differential.js";
import {
  findingArchiveVerificationPassed,
  formatFindingArchiveVerification,
  readFindingReport,
  verifyFindingArchive,
} from "../src/runner/findingArchive.js";
import { prettierFormatCrashFinding } from "../src/runner/prettierFormatCrash.js";
import { writeFinding } from "../src/runner/report.js";

const shadowPartsResults: readonly ParseResult[] = [
  { parser: "postcss", status: "accepted", durationMs: 1 },
  { parser: "prettier-css", status: "accepted", durationMs: 1 },
  { parser: "lightningcss", status: "accepted", durationMs: 1 },
  {
    parser: "oxc-css-parser",
    status: "rejected",
    durationMs: 1,
    message: "expect token `)`, but found `<ident>`",
  },
];

describe("verifyFindingArchive", () => {
  test("reports finding JSON files that are not covered by known cases", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-finding-archive-"));
    const coveredSource = "x-tabs::part(tab active) { color: red; }";
    const unarchivedSource = "x-tabs::part(tab selected) { color: red; }";
    try {
      await writeFile(path.join(dir, "campaign-summary.json"), "{}\n", "utf8");
      await writeFile(path.join(dir, "roundtrip-summary.json"), "{}\n", "utf8");
      await writeFinding(dir, finding("covered", coveredSource, shadowPartsResults));
      await writeFinding(dir, finding("unarchived", unarchivedSource, shadowPartsResults));

      const result = await verifyFindingArchive({
        findingsDir: dir,
        syntax: "css",
        knownFindings: {
          fingerprints: new Set([findingSourceFingerprint(coveredSource, shadowPartsResults)]),
          families: new Set(),
        },
      });

      expect(findingArchiveVerificationPassed(result)).toBe(false);
      expect(result.findingReports.map((report) => report.id).sort()).toEqual([
        "covered",
        "unarchived",
      ]);
      expect(result.coveredReports.map((report) => report.id)).toEqual(["covered"]);
      expect(result.unarchivedReports.map((report) => report.id)).toEqual(["unarchived"]);
      expect(result.staleReports).toEqual([]);
      expect(formatFindingArchiveVerification(result, dir)).toContain(
        "Finding archive verification failed.",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("matches minimized reports by the minimized source and result matrix", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-finding-archive-"));
    const minimizedSource = "x-tabs::part(tab active) { color: red; }";
    const minimized: MinimizedFinding = {
      original: finding(
        "minimized",
        ".wrapper { x-tabs::part(tab active) { color: red; } }",
        shadowPartsResults,
      ),
      minimizedSource,
      minimizedResults: shadowPartsResults,
      attempts: 12,
    };
    try {
      const paths = await writeFinding(dir, minimized);
      const report = await readFindingReport(paths.jsonPath);
      expect(report.source).toBe(minimizedSource);
      expect(report.results).toEqual(shadowPartsResults);

      const result = await verifyFindingArchive({
        findingsDir: dir,
        syntax: "css",
        knownFindings: {
          fingerprints: new Set([findingSourceFingerprint(minimizedSource, shadowPartsResults)]),
          families: new Set(),
        },
      });

      expect(findingArchiveVerificationPassed(result)).toBe(true);
      expect(result.coveredReports).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("replays reports with current adapters before deciding archive coverage", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-finding-archive-"));
    const source = "x-tabs::part(tab active) { color: red; }";
    try {
      await writeFinding(dir, finding("stale", source, shadowPartsResults));

      const result = await verifyFindingArchive({
        findingsDir: dir,
        syntax: "css",
        replay: {
          adapters: allAcceptedAdapters(),
          timeoutMs: 1_000,
        },
        knownFindings: {
          fingerprints: new Set(),
          families: new Set(),
        },
      });

      expect(findingArchiveVerificationPassed(result)).toBe(true);
      expect(result.unarchivedReports).toEqual([]);
      expect(result.staleReports).toHaveLength(1);
      expect(result.staleReports[0]?.currentResults).toEqual(allAcceptedResults);
      expect(formatFindingArchiveVerification(result, dir)).toContain(
        "Reports that are no longer interesting",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("preserves Prettier formatter crash report metadata", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-finding-archive-"));
    const original = finding("format-crash", ":root { --boom: 1; }", allAcceptedResults);
    try {
      const paths = await writeFinding(
        dir,
        prettierFormatCrashFinding(original.testCase, original.results, "boom"),
        {
          roundTrip: {
            oracle: "prettier-format-crash",
            originalCase: original.testCase,
            originalResults: original.results,
          },
        },
      );

      const report = await readFindingReport(paths.jsonPath);
      expect(report.oracle).toBe("prettier-format-crash");
      expect(report.results).toContainEqual(
        expect.objectContaining({ parser: "prettier-css", status: "crashed" }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

const allAcceptedResults: readonly ParseResult[] = [
  { parser: "postcss", status: "accepted", durationMs: 1 },
  { parser: "prettier-css", status: "accepted", durationMs: 1 },
  { parser: "lightningcss", status: "accepted", durationMs: 1 },
  { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
];

function finding(id: string, source: string, results: readonly ParseResult[]): DifferentialFinding {
  return {
    testCase: {
      id,
      seed: id,
      syntax: "css",
      source,
      tags: ["test"],
      specRefs: ["css-syntax-3"],
    },
    results,
    interesting: true,
    reason: "Parser status disagreement.",
  };
}

function allAcceptedAdapters(): readonly ParserAdapter[] {
  return allAcceptedResults.map((item) => ({
    name: item.parser,
    parse: async () => item,
  }));
}
