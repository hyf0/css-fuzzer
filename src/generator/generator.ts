import { fnv1a64 } from "../core/hash.js";
import { Prng } from "../core/prng.js";
import type { CssSyntax, FuzzCase } from "../core/types.js";
import { normalizeSpecExample } from "./specCorpus.js";
import { curatedSpecSeeds } from "./specSeeds.js";

interface GeneratedChunk {
  readonly source: string;
  readonly tags: readonly string[];
  readonly specRefs: readonly string[];
}

interface GeneratorOptions {
  readonly syntax: CssSyntax;
  readonly maxRules?: number;
  readonly specCorpus?: readonly GeneratedChunk[];
}

const elementNames = [
  "a",
  "article",
  "button",
  "dialog",
  "figure",
  "main",
  "section",
  "x-card",
] as const;
const classNames = ["card", "chip", "menu", "popover", "slot", "target", "theme", "view"] as const;
const pseudoClasses = [
  ":hover",
  ":focus-visible",
  ":modal",
  ":popover-open",
  ":has(> img)",
  ":is(article, section)",
  ":where([data-state='open'])",
  ":not(:defined)",
  ":nth-child(2n + 1 of .item)",
] as const;

const lengthValues = [
  "0",
  "1px",
  "1rem",
  "1lh",
  "2cqi",
  "10svh",
  "anchor-size(width)",
  "calc(1rem + 2px)",
  "clamp(1rem, 2vi, 3rem)",
] as const;

const mediaQueryLengthValues = ["1px", "40rem", "10svh", "calc(30rem + 1px)"] as const;

const colorValues = [
  "CanvasText",
  "rebeccapurple",
  "rgb(20 40 60 / 80%)",
  "oklab(65% 0.1 0.05)",
  "oklch(70% 0.12 230)",
  "color(display-p3 0.2 0.7 0.4)",
  "color-mix(in oklab, red 30%, blue)",
  "light-dark(#111, #eee)",
  "hsl(from var(--accent) h s calc(l + 10%))",
] as const;

const displayValues = [
  "block",
  "flow-root",
  "inline flex",
  "grid",
  "contents",
  "list-item flow",
  "ruby",
  "math",
] as const;

const propertyNames = [
  "accent-color",
  "animation-timeline",
  "background",
  "block-size",
  "border-color",
  "color",
  "container",
  "display",
  "font-palette",
  "grid-template-columns",
  "inset-area",
  "margin-block",
  "position-anchor",
  "scrollbar-color",
  "text-wrap",
  "translate",
  "--fuzz-token",
] as const;

const normalizedSpecCorpusCache = new WeakMap<
  readonly GeneratedChunk[],
  readonly GeneratedChunk[]
>();

export function generateCase(seed: bigint, options: GeneratorOptions): FuzzCase {
  const prng = new Prng(seed);
  const specCorpus = normalizeGeneratorSpecCorpus(options.specCorpus);
  const chunk = prng.weighted<GeneratedChunk>([
    { weight: 25, value: generateQualifiedRule(prng) },
    { weight: 20, value: generateNestedRule(prng) },
    { weight: 20, value: generateAtRule(prng) },
    { weight: 20, value: prng.pick(curatedSpecSeeds) },
    ...(specCorpus.length === 0
      ? []
      : [{ weight: 35, value: generateSpecCorpusChunk(prng, specCorpus) }]),
    { weight: 15, value: generateStylesheet(prng, options.maxRules ?? prng.int(2, 6)) },
  ]);
  const source = normalizeCss(chunk.source);
  const hash = fnv1a64(source).slice(0, 10);
  return {
    id: `css-${seed.toString(36)}-${hash}`,
    seed: seed.toString(),
    syntax: options.syntax,
    source,
    tags: chunk.tags,
    specRefs: chunk.specRefs,
  };
}

function normalizeGeneratorSpecCorpus(
  specCorpus: readonly GeneratedChunk[] | undefined,
): readonly GeneratedChunk[] {
  if (specCorpus === undefined || specCorpus.length === 0) {
    return [];
  }
  const cached = normalizedSpecCorpusCache.get(specCorpus);
  if (cached !== undefined) {
    return cached;
  }
  const normalized = specCorpus.flatMap((chunk): readonly GeneratedChunk[] => {
    const source = normalizeSpecExample(chunk.source);
    return source === undefined ? [] : [{ ...chunk, source }];
  });
  normalizedSpecCorpusCache.set(specCorpus, normalized);
  return normalized;
}

function generateStylesheet(prng: Prng, ruleCount: number): GeneratedChunk {
  const chunks: GeneratedChunk[] = [];
  const leadingImports = prng.chance(0.25) ? prng.int(1, Math.min(2, ruleCount)) : 0;
  for (let index = 0; index < leadingImports; index += 1) {
    chunks.push(generateImportRule(prng));
  }
  for (let index = leadingImports; index < ruleCount; index += 1) {
    chunks.push(
      prng.chance(0.35)
        ? generateAtRule(prng, { allowImport: false })
        : generateQualifiedRule(prng),
    );
  }
  return combine(chunks);
}

function generateSpecCorpusChunk(
  prng: Prng,
  specCorpus: readonly GeneratedChunk[],
): GeneratedChunk {
  const chunk = prng.pick(specCorpus);
  if (prng.chance(0.55)) {
    return chunk;
  }

  const source = chunk.source.trim();
  const tags = ["spec-mutation", ...chunk.tags];
  const canNest = canNestStylesheet(source);
  const choices: GeneratedChunk[] = [
    {
      source: `${source}\n\n${generateQualifiedRule(prng).source}`,
      tags: [...tags, "paired-rule"],
      specRefs: chunk.specRefs,
    },
  ];
  if (canNest) {
    choices.push(
      {
        source: `@layer ${identifier(prng)} {\n${indent(source)}\n}`,
        tags: [...tags, "cascade-layer"],
        specRefs: ["css-cascade-5", ...chunk.specRefs],
      },
      {
        source: `@media (width >= ${prng.pick(mediaQueryLengthValues)}) {\n${indent(source)}\n}`,
        tags: [...tags, "media-query"],
        specRefs: ["mediaqueries-5", ...chunk.specRefs],
      },
      {
        source: `@supports (selector(:has(*))) {\n${indent(source)}\n}`,
        tags: [...tags, "supports"],
        specRefs: ["css-conditional-5", ...chunk.specRefs],
      },
    );
  }
  return prng.pick(choices);
}

function canNestStylesheet(source: string): boolean {
  return !/^\s*@(charset|import|namespace)\b/im.test(source);
}

function generateQualifiedRule(prng: Prng): GeneratedChunk {
  const selector = generateSelector(prng);
  const declarations = Array.from({ length: prng.int(1, 5) }, () => generateDeclaration(prng));
  return {
    source: `${selector} {\n${indent(declarations.join("\n"))}\n}`,
    tags: ["qualified-rule", "selector", "declaration"],
    specRefs: ["css-syntax-3", "selectors-4", "selectors-5"],
  };
}

function generateNestedRule(prng: Prng): GeneratedChunk {
  const outer = generateSelector(prng);
  const inner = prng.pick([
    "&:hover",
    "& > .child",
    "@media (width >= 30rem)",
    "@container (inline-size > 20rem)",
  ]);
  const innerBody = inner.startsWith("@")
    ? `${inner} {\n${indent(`${generateSelector(prng)} { ${generateDeclaration(prng)} }`)}\n}`
    : `${inner} { ${generateDeclaration(prng)} }`;
  return {
    source: `${outer} {\n${indent(generateDeclaration(prng))}\n${indent(innerBody)}\n}`,
    tags: ["nesting", "selector"],
    specRefs: ["css-nesting-1", "selectors-4", "selectors-5"],
  };
}

function generateAtRule(
  prng: Prng,
  options: { readonly allowImport?: boolean } = {},
): GeneratedChunk {
  const choices = [
    { weight: 8, value: generateMediaRule(prng) },
    { weight: 8, value: generateSupportsRule(prng) },
    { weight: 8, value: generateContainerRule(prng) },
    { weight: 6, value: generateScopeRule(prng) },
    { weight: 6, value: generateLayerRule(prng) },
    { weight: 5, value: generatePropertyRule(prng) },
    { weight: 5, value: generateKeyframesRule(prng) },
    { weight: 4, value: generatePageRule(prng) },
    { weight: 4, value: generateCounterStyleRule(prng) },
    { weight: 4, value: generateFontFaceRule(prng) },
    { weight: 3, value: generateStartingStyleRule(prng) },
    { weight: 3, value: generateViewTransitionRule(prng) },
    { weight: 3, value: generatePositionTryRule(prng) },
  ];
  return prng.weighted<GeneratedChunk>(
    options.allowImport === false
      ? choices
      : [...choices, { weight: 4, value: generateImportRule(prng) }],
  );
}

function generateMediaRule(prng: Prng): GeneratedChunk {
  const feature = prng.pick([
    "(width >= 40rem)",
    "(dynamic-range: high)",
    "(prefers-reduced-motion: no-preference)",
    "(update: fast) and (scripting: enabled)",
  ]);
  return blockAtRule(
    `@media ${feature}`,
    generateQualifiedRule(prng),
    ["media-query"],
    ["mediaqueries-5"],
  );
}

function generateSupportsRule(prng: Prng): GeneratedChunk {
  const condition = prng.pick([
    "(selector(:has(*)))",
    "(color: color(display-p3 1 0 0))",
    "(font-tech(color-COLRv1))",
    "not (display: masonry)",
  ]);
  return blockAtRule(
    `@supports ${condition}`,
    generateQualifiedRule(prng),
    ["supports"],
    ["css-conditional-5"],
  );
}

function generateContainerRule(prng: Prng): GeneratedChunk {
  const condition = prng.pick([
    "(inline-size > 20rem)",
    "style(--theme: dark)",
    "card (width >= 300px)",
  ]);
  return blockAtRule(
    `@container ${condition}`,
    generateQualifiedRule(prng),
    ["container-query"],
    ["css-contain-3"],
  );
}

function generateScopeRule(prng: Prng): GeneratedChunk {
  const limit = prng.chance(0.5) ? " to (.footer)" : "";
  return blockAtRule(
    `@scope (${generateSelector(prng)})${limit}`,
    generateQualifiedRule(prng),
    ["scope"],
    ["css-cascade-6"],
  );
}

function generateLayerRule(prng: Prng): GeneratedChunk {
  const name = prng.pick(["reset", "theme", "components.card", "utilities"]);
  return blockAtRule(
    `@layer ${name}`,
    generateQualifiedRule(prng),
    ["cascade-layer"],
    ["css-cascade-5"],
  );
}

function generatePropertyRule(prng: Prng): GeneratedChunk {
  const syntax = prng.pick(["'<length>'", "'<color>'", "'*'"]);
  return {
    source: `@property --${identifier(prng)} {\n  syntax: ${syntax};\n  inherits: ${prng.pick(["true", "false"])};\n  initial-value: ${prng.pick([...lengthValues, ...colorValues])};\n}`,
    tags: ["property", "custom-property"],
    specRefs: ["css-properties-values-api-1"],
  };
}

function generateKeyframesRule(prng: Prng): GeneratedChunk {
  return {
    source: `@keyframes ${identifier(prng)} {\n  from { opacity: 0; translate: 0 ${prng.pick(lengthValues)}; }\n  50% { color: ${prng.pick(colorValues)}; }\n  to { opacity: 1; translate: 0 0; }\n}`,
    tags: ["keyframes", "animation"],
    specRefs: ["css-animations-2", "css-values-4"],
  };
}

function generatePageRule(prng: Prng): GeneratedChunk {
  const selector = prng.pick(["", ":first", ":left", ":blank"]);
  return {
    source: `@page ${selector} {\n  margin: ${prng.pick(lengthValues)};\n  @top-left { content: counter(page); }\n}`,
    tags: ["page", "nested-at-rule"],
    specRefs: ["css-page-3"],
  };
}

function generateCounterStyleRule(prng: Prng): GeneratedChunk {
  return {
    source: `@counter-style ${identifier(prng)} {\n  system: cyclic;\n  symbols: "*" "+" "~";\n  suffix: " ";\n}`,
    tags: ["counter-style"],
    specRefs: ["css-counter-styles-3"],
  };
}

function generateImportRule(prng: Prng): GeneratedChunk {
  const layer = prng.chance(0.5) ? ` layer(${identifier(prng)})` : "";
  const supports = prng.chance(0.5) ? " supports(display: grid)" : "";
  return {
    source: `@import url("${identifier(prng)}.css")${layer}${supports} screen and (width >= 40rem);`,
    tags: ["import", "cascade-layer", "supports"],
    specRefs: ["css-cascade-5", "css-conditional-5"],
  };
}

function generateFontFaceRule(prng: Prng): GeneratedChunk {
  return {
    source: `@font-face {\n  font-family: "${identifier(prng)}";\n  src: url("${identifier(prng)}.woff2") tech(color-COLRv1) format("woff2");\n  font-display: swap;\n}`,
    tags: ["font-face", "font-tech"],
    specRefs: ["css-fonts-4", "css-fonts-5"],
  };
}

function generateStartingStyleRule(prng: Prng): GeneratedChunk {
  return blockAtRule(
    "@starting-style",
    generateQualifiedRule(prng),
    ["starting-style"],
    ["css-transitions-2"],
  );
}

function generateViewTransitionRule(prng: Prng): GeneratedChunk {
  return {
    source: `@view-transition { navigation: ${prng.pick(["auto", "none"])}; }\n::view-transition-new(root) { animation-duration: ${prng.int(1, 900)}ms; }`,
    tags: ["view-transition"],
    specRefs: ["css-view-transitions-2"],
  };
}

function generatePositionTryRule(prng: Prng): GeneratedChunk {
  return {
    source: `@position-try --${identifier(prng)} {\n  inset-area: ${prng.pick(["top", "bottom", "inline-start", "block-end span-inline-end"])};\n  margin: ${prng.pick(lengthValues)};\n}`,
    tags: ["anchor-positioning", "position-try"],
    specRefs: ["css-anchor-position-1"],
  };
}

function generateSelector(prng: Prng): string {
  const base = prng.pick([
    prng.pick(elementNames),
    `.${prng.pick(classNames)}`,
    `#${identifier(prng)}`,
    `[data-${identifier(prng)}~="${identifier(prng)}" i]`,
  ]);
  const pseudo = prng.chance(0.7) ? prng.pick(pseudoClasses) : "";
  const combinator = prng.chance(0.4)
    ? ` ${prng.pick([">", "+", "~", "||"])} ${prng.pick(elementNames)}`
    : "";
  return `${base}${pseudo}${combinator}`;
}

function generateDeclaration(prng: Prng): string {
  const property = prng.pick(propertyNames);
  const value = valueForProperty(property, prng);
  const important = prng.chance(0.08) ? " !important" : "";
  return `${property}: ${value}${important};`;
}

function valueForProperty(property: (typeof propertyNames)[number], prng: Prng): string {
  switch (property) {
    case "accent-color":
    case "background":
    case "border-color":
    case "color":
    case "scrollbar-color":
      return prng.pick(colorValues);
    case "block-size":
    case "margin-block":
    case "translate":
      return prng.pick(lengthValues);
    case "container":
      return `${identifier(prng)} / inline-size`;
    case "display":
      return prng.pick(displayValues);
    case "font-palette":
      return prng.pick(["normal", "light", "--brand"]);
    case "grid-template-columns":
      return prng.pick(["subgrid", "masonry", "repeat(auto-fit, minmax(10rem, 1fr))"]);
    case "inset-area":
      return prng.pick(["top", "bottom", "inline-start", "block-end span-inline-end"]);
    case "position-anchor":
      return `--${identifier(prng)}`;
    case "animation-timeline":
      return prng.pick(["auto", "scroll(root block)", "view(inline)", "--scroller"]);
    case "text-wrap":
      return prng.pick(["balance", "pretty", "stable"]);
    case "--fuzz-token":
      return prng.pick([...lengthValues, ...colorValues, "var(--missing, revert-layer)"]);
  }
}

function identifier(prng: Prng): string {
  const start = prng.pick(["a", "b", "c", "x", "fuzz", "theme", "view"]);
  return `${start}-${prng.int(0, 999).toString(36)}`;
}

function blockAtRule(
  prelude: string,
  body: GeneratedChunk,
  tags: readonly string[],
  specRefs: readonly string[],
): GeneratedChunk {
  return {
    source: `${prelude} {\n${indent(body.source)}\n}`,
    tags: [...tags, ...body.tags],
    specRefs: [...specRefs, ...body.specRefs],
  };
}

function combine(chunks: readonly GeneratedChunk[]): GeneratedChunk {
  return {
    source: chunks.map((chunk) => chunk.source).join("\n\n"),
    tags: [...new Set(chunks.flatMap((chunk) => chunk.tags))],
    specRefs: [...new Set(chunks.flatMap((chunk) => chunk.specRefs))],
  };
}

function indent(source: string): string {
  return source
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function normalizeCss(source: string): string {
  return `${source.trim()}\n`;
}
