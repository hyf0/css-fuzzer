import { generateCase } from "../generator/generator.js";
import type { SpecSeed } from "../generator/specSeeds.js";
import { requiredModernSpecSlugs } from "../specs/fetchCsswg.js";
import type { CssSyntax } from "../core/types.js";

export const requiredGeneratorTags = [
  "qualified-rule",
  "nesting",
  "spec-example",
  "spec-mutation",
  "media-query",
  "supports",
  "cascade-layer",
  "container-query",
  "property",
  "keyframes",
  "page",
  "font-face",
  "scope",
  "view-transition",
  "anchor-positioning",
  "import",
] as const;

export interface GeneratorCoverageOptions {
  readonly seed: bigint;
  readonly count: number;
  readonly syntax: CssSyntax;
  readonly specCorpus: readonly SpecSeed[];
  readonly requiredSpecRefs?: readonly string[];
  readonly requiredTags?: readonly string[];
}

export interface GeneratorCoverageNameCount {
  readonly name: string;
  readonly count: number;
}

export interface GeneratorCoverageResult {
  readonly seed: string;
  readonly count: number;
  readonly syntax: CssSyntax;
  readonly generatedCases: number;
  readonly specCorpusExamples: number;
  readonly requiredSpecRefs: readonly string[];
  readonly requiredTags: readonly string[];
  readonly missingRequiredSpecRefs: readonly string[];
  readonly missingRequiredTags: readonly string[];
  readonly generatedSpecRefs: readonly GeneratorCoverageNameCount[];
  readonly generatedTags: readonly GeneratorCoverageNameCount[];
}

export function verifyGeneratorCoverage(
  options: GeneratorCoverageOptions,
): GeneratorCoverageResult {
  const requiredSpecRefs = options.requiredSpecRefs ?? requiredModernSpecSlugs;
  const requiredTags = options.requiredTags ?? requiredGeneratorTags;
  const generatedSpecRefs = new Map<string, number>();
  const generatedTags = new Map<string, number>();

  for (let index = 0; index < options.count; index += 1) {
    const testCase = generateCase(options.seed + BigInt(index), {
      syntax: options.syntax,
      specCorpus: options.specCorpus,
    });
    incrementCounts(generatedSpecRefs, testCase.specRefs);
    incrementCounts(generatedTags, testCase.tags);
  }

  return {
    seed: options.seed.toString(),
    count: options.count,
    syntax: options.syntax,
    generatedCases: options.count,
    specCorpusExamples: options.specCorpus.length,
    requiredSpecRefs,
    requiredTags,
    missingRequiredSpecRefs: requiredSpecRefs
      .filter((slug) => !generatedSpecRefs.has(slug))
      .sort((left, right) => left.localeCompare(right)),
    missingRequiredTags: requiredTags
      .filter((tag) => !generatedTags.has(tag))
      .sort((left, right) => left.localeCompare(right)),
    generatedSpecRefs: sortedNameCounts(generatedSpecRefs),
    generatedTags: sortedNameCounts(generatedTags),
  };
}

export function generatorCoveragePassed(result: GeneratorCoverageResult): boolean {
  return result.missingRequiredSpecRefs.length === 0 && result.missingRequiredTags.length === 0;
}

export function formatGeneratorCoverage(result: GeneratorCoverageResult): string {
  const lines = [
    `Generator coverage: seed ${result.seed}; count ${result.count}; syntax ${result.syntax}`,
    `Generated cases: ${result.generatedCases}; spec corpus examples: ${result.specCorpusExamples}`,
    `Required spec refs: ${result.requiredSpecRefs.length - result.missingRequiredSpecRefs.length}/${result.requiredSpecRefs.length}`,
    `Required generator tags: ${result.requiredTags.length - result.missingRequiredTags.length}/${result.requiredTags.length}`,
  ];

  if (result.missingRequiredSpecRefs.length > 0) {
    lines.push("", "Required spec refs not generated:");
    for (const slug of result.missingRequiredSpecRefs) {
      lines.push(`- ${slug}`);
    }
  }

  if (result.missingRequiredTags.length > 0) {
    lines.push("", "Required generator tags not generated:");
    for (const tag of result.missingRequiredTags) {
      lines.push(`- ${tag}`);
    }
  }

  lines.push(
    "",
    generatorCoveragePassed(result)
      ? "Generator coverage verification passed."
      : "Generator coverage verification failed.",
  );
  return `${lines.join("\n")}\n`;
}

function incrementCounts(counts: Map<string, number>, values: readonly string[]): void {
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
}

function sortedNameCounts(
  counts: ReadonlyMap<string, number>,
): readonly GeneratorCoverageNameCount[] {
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}
