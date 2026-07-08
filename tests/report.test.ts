import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import type { DifferentialFinding } from "../src/core/types.js";
import type { FuzzerEnvironment } from "../src/runner/environment.js";
import {
  type FuzzCampaignSummary,
  type FuzzRunReport,
  type RoundTripRunReport,
  type RoundTripSummary,
  writeCampaignSummary,
  writeFinding,
  writeRoundTripSummary,
} from "../src/runner/report.js";

const finding: DifferentialFinding = {
  testCase: {
    id: "case",
    seed: "1",
    syntax: "css",
    source: "a { color: red; }",
    tags: ["test"],
    specRefs: ["css-syntax-3"],
  },
  results: [
    { parser: "postcss", status: "accepted", durationMs: 1 },
    { parser: "lightningcss", status: "rejected", durationMs: 1, message: "bad" },
  ],
  interesting: true,
  reason: "Parser status disagreement.",
};

const environment: FuzzerEnvironment = {
  node: "v24.0.0",
  packageManager: "pnpm@test",
  parsers: [
    { parser: "postcss", packageName: "postcss", version: "1.0.0" },
    { parser: "prettier-css", packageName: "prettier", version: "2.0.0" },
    { parser: "lightningcss", packageName: "lightningcss", version: "3.0.0" },
    { parser: "oxc-css-parser", packageName: "oxc-css-parser", gitHead: "abc123" },
  ],
};

const run: FuzzRunReport = {
  command: "fuzz",
  seed: "1000",
  iterations: 500,
  syntax: "css",
  timeoutMs: 1500,
  minimize: true,
  minimizeAttempts: 80,
  byteMinimize: false,
  outDir: "findings/campaign",
  specCorpusPath: "data/specs/examples.json",
  knownDir: "../css-parser-fuzzer-cases/cases",
};

const roundTripRun: RoundTripRunReport = {
  command: "verify-lightning-roundtrip",
  seed: "2000",
  count: 1000,
  syntax: "css",
  timeoutMs: 1500,
  minimize: true,
  minimizeAttempts: 80,
  byteMinimize: false,
  outDir: "findings/roundtrip",
  specCorpusPath: "data/specs/examples.json",
  knownDir: "../css-parser-fuzzer-cases/cases",
};

describe("writeFinding", () => {
  test("writes replayable CSS and metadata-wrapped JSON", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-report-"));
    try {
      const paths = await writeFinding(dir, finding, { environment, run });
      await expect(readFile(paths.cssPath, "utf8")).resolves.toBe("a { color: red; }\n");

      const report = JSON.parse(await readFile(paths.jsonPath, "utf8")) as {
        readonly environment?: FuzzerEnvironment;
        readonly run?: FuzzRunReport;
        readonly finding?: DifferentialFinding;
      };
      expect(report.environment).toEqual(environment);
      expect(report.run).toEqual(run);
      expect(report.finding?.testCase.id).toBe("case");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("writes roundtrip metadata with the original trigger case", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-report-"));
    const originalCase = {
      ...finding.testCase,
      id: "case-original",
      source: "@scope (.x || a) { a { color: red; } }",
    };
    const originalResults = [
      { parser: "postcss", status: "accepted", durationMs: 1 },
      { parser: "lightningcss", status: "accepted", durationMs: 1 },
    ] satisfies DifferentialFinding["results"];
    try {
      const paths = await writeFinding(dir, finding, {
        environment,
        run: roundTripRun,
        roundTrip: {
          oracle: "lightning-roundtrip",
          originalCase,
          originalResults,
        },
      });

      const report = JSON.parse(await readFile(paths.jsonPath, "utf8")) as {
        readonly run?: RoundTripRunReport;
        readonly roundTrip?: {
          readonly oracle: "lightning-roundtrip";
          readonly originalCase: typeof originalCase;
          readonly originalResults: typeof originalResults;
        };
        readonly finding?: DifferentialFinding;
      };
      expect(report.run).toEqual(roundTripRun);
      expect(report.roundTrip?.oracle).toBe("lightning-roundtrip");
      expect(report.roundTrip?.originalCase).toEqual(originalCase);
      expect(report.roundTrip?.originalResults).toEqual(originalResults);
      expect(report.finding?.testCase.id).toBe("case");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("does not overwrite an existing finding report", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-report-"));
    try {
      await writeFinding(dir, finding, { environment, run });
      await expect(writeFinding(dir, finding, { environment, run })).rejects.toMatchObject({
        code: "EEXIST",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("writeCampaignSummary", () => {
  const summary: FuzzCampaignSummary = {
    completedAt: "2026-07-08T00:00:00.000Z",
    environment,
    run,
    counts: {
      iterations: 500,
      newFindings: 1,
      knownSkipped: 2,
      duplicateSkipped: 3,
      knownSourceFingerprints: 30,
      knownIssueFamilies: 22,
    },
    coverage: {
      generatedTags: [
        { name: "spec-example", count: 320 },
        { name: "selector", count: 120 },
      ],
      generatedSpecRefs: [
        { name: "css-color-5", count: 42 },
        { name: "selectors-4", count: 36 },
      ],
    },
    findings: [{ cssPath: "findings/campaign/case.css", jsonPath: "findings/campaign/case.json" }],
  };

  test("writes campaign-level counts and output paths", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-summary-"));
    try {
      const summaryPath = await writeCampaignSummary(dir, summary);
      const report = JSON.parse(await readFile(summaryPath, "utf8")) as FuzzCampaignSummary;
      expect(path.basename(summaryPath)).toBe("campaign-summary.json");
      expect(report).toEqual(summary);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("does not overwrite an existing campaign summary", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-summary-"));
    try {
      await writeCampaignSummary(dir, summary);
      await expect(writeCampaignSummary(dir, summary)).rejects.toMatchObject({ code: "EEXIST" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("writeRoundTripSummary", () => {
  const summary: RoundTripSummary = {
    completedAt: "2026-07-08T00:00:00.000Z",
    environment,
    run: roundTripRun,
    counts: {
      generatedCases: 1000,
      checkedOutputs: 820,
      skippedRejectedInputs: 100,
      skippedMissingOutputs: 0,
      skippedUnchangedOutputs: 80,
      knownSkipped: 8,
      duplicateSkipped: 2,
      mismatches: 1,
      writtenFindings: 1,
    },
    findings: [
      { cssPath: "findings/roundtrip/case.css", jsonPath: "findings/roundtrip/case.json" },
    ],
  };

  test("writes roundtrip-level counts and output paths", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-roundtrip-summary-"));
    try {
      const summaryPath = await writeRoundTripSummary(dir, summary);
      const report = JSON.parse(await readFile(summaryPath, "utf8")) as RoundTripSummary;
      expect(path.basename(summaryPath)).toBe("roundtrip-summary.json");
      expect(report).toEqual(summary);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("does not overwrite an existing roundtrip summary", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-roundtrip-summary-"));
    try {
      await writeRoundTripSummary(dir, summary);
      await expect(writeRoundTripSummary(dir, summary)).rejects.toMatchObject({ code: "EEXIST" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
