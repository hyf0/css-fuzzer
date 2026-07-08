import { describe, expect, test } from "vite-plus/test";
import { generateCase } from "../src/generator/generator.js";

describe("generateCase", () => {
  test("generates replayable CSS", () => {
    const first = generateCase(123n, { syntax: "css" });
    const second = generateCase(123n, { syntax: "css" });
    expect(first).toEqual(second);
    expect(first.source.trim().length).toBeGreaterThan(0);
    expect(first.tags.length).toBeGreaterThan(0);
    expect(first.specRefs.length).toBeGreaterThan(0);
  });

  test("does not place @import after ordinary top-level rules", () => {
    for (let seed = 1n; seed <= 500n; seed += 1n) {
      const testCase = generateCase(seed, { syntax: "css" });
      expect(hasLateImport(testCase.source), testCase.source).toBe(false);
    }
  });

  test("mutates downloaded spec corpus examples while preserving spec refs", () => {
    const specCorpus = [
      {
        source: ".spec-source { color: oklch(70% 0.1 230); }",
        tags: ["spec-example", "css-color-5"],
        specRefs: ["css-color-5"],
      },
    ];
    const mutated = [];
    for (let seed = 1n; seed <= 1_000n; seed += 1n) {
      const testCase = generateCase(seed, { syntax: "css", specCorpus });
      if (testCase.tags.includes("spec-mutation")) {
        mutated.push(testCase);
      }
    }

    expect(mutated.length).toBeGreaterThan(0);
    expect(mutated.every((testCase) => testCase.specRefs.includes("css-color-5"))).toBe(true);
    expect(
      mutated.every(
        (testCase) => !/@media\s*\(\s*width\s*>=\s*anchor-size\(/.test(testCase.source),
      ),
    ).toBe(true);
    expect(
      mutated.some(
        (testCase) =>
          testCase.source.includes("@layer") ||
          testCase.source.includes("@media") ||
          testCase.source.includes("@supports") ||
          testCase.tags.includes("paired-rule"),
      ),
    ).toBe(true);
  });

  test("ignores invalid spec corpus chunks at generation time", () => {
    const specCorpus = [
      {
        source: "hard line break after the third SPAN: ‘span:nth-child(3)::after { color: red; }",
        tags: ["spec-example", "bad-smart-quote-prose"],
        specRefs: ["css-template-1"],
      },
      {
        source: "could have an @template :first { color: red; }",
        tags: ["spec-example", "bad-at-rule-prose"],
        specRefs: ["css-page-template-1"],
      },
      {
        source: ".valid-spec-source { color: oklch(70% 0.1 230); }",
        tags: ["spec-example", "css-color-5"],
        specRefs: ["css-color-5"],
      },
    ];
    const generated = [];
    for (let seed = 1n; seed <= 1_000n; seed += 1n) {
      generated.push(generateCase(seed, { syntax: "css", specCorpus }));
    }

    expect(
      generated.some(
        (testCase) =>
          testCase.tags.includes("bad-smart-quote-prose") ||
          testCase.tags.includes("bad-at-rule-prose") ||
          testCase.source.includes("hard line break after the third SPAN") ||
          testCase.source.includes("could have an @template"),
      ),
    ).toBe(false);
    expect(generated.some((testCase) => testCase.specRefs.includes("css-color-5"))).toBe(true);
  });

  test("does not nest top-level-only spec corpus at-rules", () => {
    const specCorpus = [
      {
        source: '@import url("theme.css");',
        tags: ["spec-example", "css-cascade-5"],
        specRefs: ["css-cascade-5"],
      },
      {
        source: '@namespace svg "http://www.w3.org/2000/svg";\nsvg|a { fill: currentColor; }',
        tags: ["spec-example", "css-namespaces-3"],
        specRefs: ["css-namespaces-3"],
      },
    ];
    for (let seed = 1n; seed <= 1_000n; seed += 1n) {
      const testCase = generateCase(seed, { syntax: "css", specCorpus });
      if (testCase.tags.includes("spec-mutation")) {
        expect(testCase.source).not.toMatch(/@(layer|media|supports)[\s\S]*@(import|namespace)\b/);
      }
    }
  });
});

function hasLateImport(source: string): boolean {
  const importIndex = source.indexOf("@import");
  if (importIndex === -1) {
    return false;
  }
  const beforeImport = source.slice(0, importIndex).trim();
  return !/^(?:@charset\s+[^;]+;\s*|@layer\s+[\w\s,.-]+;\s*)*$/.test(beforeImport);
}
