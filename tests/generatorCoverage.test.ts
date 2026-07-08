import { describe, expect, test } from "vite-plus/test";
import {
  formatGeneratorCoverage,
  generatorCoveragePassed,
  verifyGeneratorCoverage,
} from "../src/runner/generatorCoverage.js";

describe("generator coverage verification", () => {
  test("passes when a deterministic seed window generates required specs and tags", () => {
    const result = verifyGeneratorCoverage({
      seed: 1n,
      count: 1_000,
      syntax: "css",
      specCorpus: [
        {
          source: ".from-corpus { color: oklch(70% 0.1 230); }",
          tags: ["spec-example", "css-color-5"],
          specRefs: ["css-color-5"],
        },
      ],
      requiredSpecRefs: ["css-color-5", "selectors-4"],
      requiredTags: ["spec-example", "spec-mutation", "qualified-rule", "nesting"],
    });

    expect(generatorCoveragePassed(result)).toBe(true);
    expect(result.missingRequiredSpecRefs).toEqual([]);
    expect(result.missingRequiredTags).toEqual([]);
    expect(formatGeneratorCoverage(result)).toContain("Generator coverage verification passed.");
  });

  test("fails when required specs or tags are not generated", () => {
    const result = verifyGeneratorCoverage({
      seed: 1n,
      count: 20,
      syntax: "css",
      specCorpus: [],
      requiredSpecRefs: ["css-missing-1"],
      requiredTags: ["missing-tag"],
    });

    expect(generatorCoveragePassed(result)).toBe(false);
    expect(result.missingRequiredSpecRefs).toEqual(["css-missing-1"]);
    expect(result.missingRequiredTags).toEqual(["missing-tag"]);
    expect(formatGeneratorCoverage(result)).toContain("Generator coverage verification failed.");
  });
});
