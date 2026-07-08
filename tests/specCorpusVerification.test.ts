import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  formatSpecCorpusVerification,
  specCorpusVerificationPassed,
  verifySpecCorpus,
} from "../src/runner/specCorpusVerification.js";

describe("spec corpus verification", () => {
  test("passes when required specs are selected and downloaded", async () => {
    const file = await writeCorpus({
      selectedSlugs: ["css-color-4", "css-values-5"],
      downloadedSlugs: ["css-color-4", "css-values-5"],
      failedSpecs: [],
      exampleCountsBySpec: [
        { slug: "css-color-4", extractedExamples: 1 },
        { slug: "css-values-5", extractedExamples: 0 },
      ],
      examples: [{ slug: "css-color-4", source: "a { color: red; }" }],
    });
    try {
      const result = verifySpecCorpus({
        path: file,
        requiredSlugs: ["css-color-4", "css-values-5"],
        curatedSeeds: [
          {
            source: ".x { width: 1px; }",
            tags: ["test"],
            specRefs: ["css-values-5"],
          },
        ],
      });

      expect(specCorpusVerificationPassed(result)).toBe(true);
      expect(result.selectedWithZeroExtractedExamples).toEqual(["css-values-5"]);
      expect(result.selectedWithZeroNormalizedExamples).toEqual(["css-values-5"]);
      expect(result.selectedWithZeroGeneratedCoverage).toEqual([]);
      expect(formatSpecCorpusVerification(result)).toContain("Spec corpus verification passed.");
    } finally {
      await rm(path.dirname(file), { recursive: true, force: true });
    }
  });

  test("fails when a required latest CSSWG index is missing", async () => {
    const file = await writeCorpus({
      selectedSlugs: ["css-color-4"],
      downloadedSlugs: ["css-color-4"],
      failedSpecs: [],
      exampleCountsBySpec: [{ slug: "css-color-4", extractedExamples: 1 }],
      examples: [{ slug: "css-color-4", source: "a { color: red; }" }],
    });
    try {
      const result = verifySpecCorpus({
        path: file,
        requireLatestIndex: true,
        requiredSlugs: ["css-color-4"],
      });

      expect(specCorpusVerificationPassed(result)).toBe(false);
      expect(result.latestIndexMissing).toBe(true);
      expect(formatSpecCorpusVerification(result)).toContain(
        "Required CSSWG index file is missing:",
      );
    } finally {
      await rm(path.dirname(file), { recursive: true, force: true });
    }
  });

  test("fails when latest CSSWG family specs are absent from the corpus", async () => {
    const file = await writeCorpus({
      selectedSlugs: ["css-color-4"],
      downloadedSlugs: ["css-color-4"],
      failedSpecs: [],
      exampleCountsBySpec: [{ slug: "css-color-4", extractedExamples: 1 }],
      examples: [{ slug: "css-color-4", source: "a { color: red; }" }],
    });
    try {
      await writeCsswgIndex(file, ["css-color-4", "css-color-6", "css-egg-1", "css-2026"]);
      const result = verifySpecCorpus({
        path: file,
        requireLatestIndex: true,
        requiredSlugs: ["css-color-4"],
      });

      expect(specCorpusVerificationPassed(result)).toBe(false);
      expect(result.latestIndexMissing).toBe(false);
      expect(result.latestIndexSlugs).toEqual(["css-color-6"]);
      expect(result.missingLatestSelected).toEqual(["css-color-6"]);
      expect(result.missingLatestDownloaded).toEqual(["css-color-6"]);
      expect(formatSpecCorpusVerification(result)).toContain(
        "Latest CSSWG family specs missing from selected set:",
      );
    } finally {
      await rm(path.dirname(file), { recursive: true, force: true });
    }
  });

  test("fails when the corpus is older than the configured freshness limit", async () => {
    const file = await writeCorpus(
      {
        selectedSlugs: ["css-color-4"],
        downloadedSlugs: ["css-color-4"],
        failedSpecs: [],
        exampleCountsBySpec: [{ slug: "css-color-4", extractedExamples: 1 }],
        examples: [{ slug: "css-color-4", source: "a { color: red; }" }],
      },
      { fetchedAt: "2026-07-06T00:00:00.000Z" },
    );
    try {
      const result = verifySpecCorpus({
        path: file,
        requiredSlugs: ["css-color-4"],
        maxAgeHours: 24,
        now: new Date("2026-07-08T00:00:00.000Z"),
      });

      expect(specCorpusVerificationPassed(result)).toBe(false);
      expect(result.corpusStale).toBe(true);
      expect(result.corpusAgeHours).toBe(48);
      expect(formatSpecCorpusVerification(result)).toContain(
        "Spec corpus is older than the configured freshness limit:",
      );
    } finally {
      await rm(path.dirname(file), { recursive: true, force: true });
    }
  });

  test("fails when the CSSWG index was not produced by the same fetch as the corpus", async () => {
    const file = await writeCorpus(
      {
        selectedSlugs: ["css-color-4"],
        downloadedSlugs: ["css-color-4"],
        failedSpecs: [],
        exampleCountsBySpec: [{ slug: "css-color-4", extractedExamples: 1 }],
        examples: [{ slug: "css-color-4", source: "a { color: red; }" }],
      },
      { fetchedAt: "2026-07-08T00:00:00.000Z" },
    );
    try {
      await writeCsswgIndex(file, ["css-color-4"], { fetchedAt: "2026-07-08T00:01:00.000Z" });
      const result = verifySpecCorpus({
        path: file,
        requireLatestIndex: true,
        requiredSlugs: ["css-color-4"],
        maxAgeHours: 24,
        now: new Date("2026-07-08T01:00:00.000Z"),
      });

      expect(specCorpusVerificationPassed(result)).toBe(false);
      expect(result.corpusIndexFetchedAtMismatch).toBe(true);
      expect(formatSpecCorpusVerification(result)).toContain(
        "Spec corpus and CSSWG index were not produced by the same fetch:",
      );
    } finally {
      await rm(path.dirname(file), { recursive: true, force: true });
    }
  });

  test("fails when a required spec was not downloaded", async () => {
    const file = await writeCorpus({
      selectedSlugs: ["css-color-4", "css-values-5"],
      downloadedSlugs: ["css-color-4"],
      failedSpecs: [{ slug: "css-values-5" }],
      exampleCountsBySpec: [{ slug: "css-color-4", extractedExamples: 1 }],
      examples: [{ slug: "css-color-4", source: "a { color: red; }" }],
    });
    try {
      const result = verifySpecCorpus({
        path: file,
        requiredSlugs: ["css-color-4", "css-values-5"],
      });

      expect(specCorpusVerificationPassed(result)).toBe(false);
      expect(result.failedSpecs).toEqual(["css-values-5"]);
      expect(result.missingRequiredDownloaded).toEqual(["css-values-5"]);
      expect(formatSpecCorpusVerification(result)).toContain("Spec corpus verification failed.");
    } finally {
      await rm(path.dirname(file), { recursive: true, force: true });
    }
  });

  test("fails when a required spec has no normalized or curated generated coverage", async () => {
    const file = await writeCorpus({
      selectedSlugs: ["css-color-4", "css-values-5"],
      downloadedSlugs: ["css-color-4", "css-values-5"],
      failedSpecs: [],
      exampleCountsBySpec: [
        { slug: "css-color-4", extractedExamples: 1 },
        { slug: "css-values-5", extractedExamples: 0 },
      ],
      examples: [{ slug: "css-color-4", source: "a { color: red; }" }],
    });
    try {
      const result = verifySpecCorpus({
        path: file,
        requiredSlugs: ["css-color-4", "css-values-5"],
        curatedSeeds: [],
      });

      expect(specCorpusVerificationPassed(result)).toBe(false);
      expect(result.missingRequiredGeneratedCoverage).toEqual(["css-values-5"]);
      expect(result.selectedWithZeroGeneratedCoverage).toEqual(["css-values-5"]);
      expect(formatSpecCorpusVerification(result)).toContain(
        "Required specs without generated coverage:",
      );
    } finally {
      await rm(path.dirname(file), { recursive: true, force: true });
    }
  });

  test("fails when any selected spec has no generated coverage", async () => {
    const file = await writeCorpus({
      selectedSlugs: ["css-color-4", "css-extra-1"],
      downloadedSlugs: ["css-color-4", "css-extra-1"],
      failedSpecs: [],
      exampleCountsBySpec: [
        { slug: "css-color-4", extractedExamples: 1 },
        { slug: "css-extra-1", extractedExamples: 0 },
      ],
      examples: [{ slug: "css-color-4", source: "a { color: red; }" }],
    });
    try {
      const result = verifySpecCorpus({
        path: file,
        requiredSlugs: ["css-color-4"],
        curatedSeeds: [],
      });

      expect(specCorpusVerificationPassed(result)).toBe(false);
      expect(result.missingRequiredGeneratedCoverage).toEqual([]);
      expect(result.selectedWithZeroGeneratedCoverage).toEqual(["css-extra-1"]);
    } finally {
      await rm(path.dirname(file), { recursive: true, force: true });
    }
  });
});

async function writeCorpus(
  corpus: {
    readonly selectedSlugs: readonly string[];
    readonly downloadedSlugs: readonly string[];
    readonly failedSpecs: readonly { readonly slug: string }[];
    readonly exampleCountsBySpec: readonly {
      readonly slug: string;
      readonly extractedExamples: number;
    }[];
    readonly examples: readonly { readonly slug: string; readonly source: string }[];
  },
  options: { readonly fetchedAt?: string } = {},
): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-spec-verify-"));
  const file = path.join(dir, "examples.json");
  await writeFile(
    file,
    JSON.stringify({
      fetchedAt: options.fetchedAt ?? "2026-07-08T00:00:00.000Z",
      ...corpus,
    }),
    "utf8",
  );
  return file;
}

async function writeCsswgIndex(
  file: string,
  slugs: readonly string[],
  options: { readonly fetchedAt?: string } = {},
): Promise<void> {
  await writeFile(
    path.join(path.dirname(file), "csswg-index.json"),
    JSON.stringify({
      fetchedAt: options.fetchedAt ?? "2026-07-08T00:00:00.000Z",
      specs: slugs.map((slug) => ({
        slug,
        title: slug,
        url: `https://drafts.csswg.org/${slug}/`,
      })),
    }),
    "utf8",
  );
}
