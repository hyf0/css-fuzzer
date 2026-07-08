import { readFileSync } from "node:fs";
import type { SpecSeed } from "./specSeeds.js";

export interface SpecCorpusOptions {
  readonly path: string;
  readonly maxExamples?: number;
}

export interface SpecCorpusAudit {
  readonly fetchedAt?: string;
  readonly selectedSlugs: readonly string[];
  readonly downloadedSlugs: readonly string[];
  readonly failedSpecs: readonly string[];
  readonly exampleCountsBySpec: ReadonlyMap<string, number>;
  readonly examples: number;
}

export interface SpecCorpusAuditOptions {
  readonly maxAgeHours?: number;
  readonly now?: Date;
}

interface SpecCorpusFile {
  readonly fetchedAt?: unknown;
  readonly selectedSlugs?: readonly unknown[];
  readonly downloadedSlugs?: readonly unknown[];
  readonly failedSpecs?: readonly UnknownFailedSpec[];
  readonly exampleCountsBySpec?: readonly UnknownExampleCount[];
  readonly examples?: readonly UnknownSpecExample[];
}

interface UnknownSpecExample {
  readonly slug?: unknown;
  readonly source?: unknown;
}

interface UnknownFailedSpec {
  readonly slug?: unknown;
}

interface UnknownExampleCount {
  readonly slug?: unknown;
  readonly extractedExamples?: unknown;
}

export function loadSpecCorpus(options: SpecCorpusOptions): readonly SpecSeed[] {
  const text = readFileSync(options.path, "utf8");
  const parsed = JSON.parse(text) as SpecCorpusFile;
  const examples = parsed.examples ?? [];
  const seeds: SpecSeed[] = [];
  const maxExamples = options.maxExamples ?? examples.length;

  for (const example of examples) {
    if (seeds.length >= maxExamples) {
      break;
    }
    if (typeof example.slug !== "string" || typeof example.source !== "string") {
      continue;
    }
    const source = normalizeSpecExample(example.source);
    if (source === undefined) {
      continue;
    }
    seeds.push({
      source,
      tags: ["spec-example", example.slug],
      specRefs: [example.slug],
    });
  }

  return seeds;
}

export function readSpecCorpusAudit(path: string): SpecCorpusAudit {
  const text = readFileSync(path, "utf8");
  const parsed = JSON.parse(text) as SpecCorpusFile;
  return {
    ...(typeof parsed.fetchedAt === "string" ? { fetchedAt: parsed.fetchedAt } : {}),
    selectedSlugs: stringsFromUnknownArray(parsed.selectedSlugs),
    downloadedSlugs: stringsFromUnknownArray(parsed.downloadedSlugs),
    failedSpecs: (parsed.failedSpecs ?? [])
      .map((item) => item.slug)
      .filter((slug): slug is string => typeof slug === "string"),
    exampleCountsBySpec: new Map(
      (parsed.exampleCountsBySpec ?? []).flatMap((item) =>
        typeof item.slug === "string" &&
        typeof item.extractedExamples === "number" &&
        Number.isSafeInteger(item.extractedExamples)
          ? [[item.slug, item.extractedExamples] as const]
          : [],
      ),
    ),
    examples: parsed.examples?.length ?? 0,
  };
}

export function assertAuditableSpecCorpus(
  path: string,
  options: SpecCorpusAuditOptions = {},
): void {
  const audit = readSpecCorpusAudit(path);
  const missingManifest =
    audit.fetchedAt === undefined ||
    audit.selectedSlugs.length === 0 ||
    audit.downloadedSlugs.length === 0;
  if (missingManifest) {
    throw new Error(
      `Spec corpus at ${path} does not include a complete download manifest. Run "vp run fetch-specs -- --download" to refresh it.`,
    );
  }
  if (audit.failedSpecs.length > 0) {
    throw new Error(
      `Spec corpus at ${path} has failed spec downloads: ${audit.failedSpecs.join(", ")}. Re-run fetch-specs without failures before fuzzing, or regenerate intentionally with --allow-fetch-failures only for debugging.`,
    );
  }
  if (options.maxAgeHours !== undefined) {
    const ageHours = specCorpusAgeHours(audit.fetchedAt, options.now);
    if (ageHours === undefined) {
      throw new Error(
        `Spec corpus at ${path} has an invalid fetchedAt timestamp. Run "vp run fetch-specs -- --download" to refresh it.`,
      );
    }
    if (ageHours > options.maxAgeHours) {
      throw new Error(
        `Spec corpus at ${path} is ${ageHours.toFixed(1)} hours old, which is older than the ${options.maxAgeHours} hour limit. Run "vp run fetch-specs -- --download" to refresh it, or pass --max-spec-corpus-age-hours with an intentional larger limit for reproduction.`,
      );
    }
  }
}

export function specCorpusAgeHours(
  fetchedAt: string | undefined,
  now: Date = new Date(),
): number | undefined {
  if (fetchedAt === undefined) {
    return undefined;
  }
  const fetchedAtMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) {
    return undefined;
  }
  return Math.max(0, now.getTime() - fetchedAtMs) / 3_600_000;
}

export function normalizeSpecExample(source: string): string | undefined {
  const trimmed = source.trim();
  if (trimmed.length < 4 || trimmed.length > 20_000) {
    return undefined;
  }
  const lines = trimmed.split(/\r?\n/);
  const start = lines.findIndex((line) => isCssStartLine(line));
  if (start === -1) {
    return undefined;
  }

  const kept: string[] = [];
  let balance: DelimiterBalance = { braces: 0, brackets: 0, parens: 0 };
  let sawCompletedTopLevelBlock = false;
  let sawCssToken = false;

  for (const line of lines.slice(start)) {
    if (kept.length > 0 && isBalanced(balance) && isClearlyNonCssLine(line)) {
      break;
    }
    if (
      kept.length > 0 &&
      isBalanced(balance) &&
      sawCompletedTopLevelBlock &&
      isDeclarationSnippet(line)
    ) {
      break;
    }
    if (kept.length > 0 && isBalanced(balance) && line.trim() !== "" && !isTopLevelCssLine(line)) {
      break;
    }

    kept.push(line);
    balance = addDelimiterBalance(balance, line);
    sawCompletedTopLevelBlock ||= isBalanced(balance) && line.includes("}");
    sawCssToken ||= /[{}:;]/.test(line);
  }

  const normalized = kept.join("\n").trim();
  if (!sawCssToken || normalized.length < 4 || normalized.length > 20_000) {
    return undefined;
  }
  if (isLikelyNonCssSnippet(normalized)) {
    return undefined;
  }
  if (!isBalanced(scanDelimiterBalance(normalized))) {
    return undefined;
  }
  if (isDeclarationSnippet(normalized)) {
    return wrapDeclarationSnippet(normalized);
  }
  return hasTopLevelBlock(normalized) ? normalized : undefined;
}

function stringsFromUnknownArray(value: readonly unknown[] | undefined): readonly string[] {
  return (value ?? []).filter((item): item is string => typeof item === "string");
}

function isCssStartLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "" || isClearlyNonCssLine(trimmed)) {
    return false;
  }
  return (
    trimmed.startsWith("@") ||
    /^\*\s*\{/.test(trimmed) ||
    isSelectorRuleStartLine(trimmed) ||
    isDeclarationSnippet(trimmed) ||
    isSelectorPreludeLine(trimmed)
  );
}

function isTopLevelCssLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed === "" || trimmed.startsWith("/*") || trimmed.startsWith("*") || isCssStartLine(trimmed)
  );
}

function isClearlyNonCssLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^\*\s*@/.test(trimmed) ||
    /^\*\/$/.test(trimmed) ||
    /^[A-Z][a-z]+:/.test(trimmed) ||
    /^(CSS|HTML|JavaScript|JS):$/i.test(trimmed) ||
    /^[A-Z][a-z]+\b.*\s/.test(trimmed) ||
    /^<[^>]+>/.test(trimmed) ||
    /<\/[a-z][^>]*>/i.test(trimmed) ||
    /^(for example|the following|then |notably|because|where |while |so |and |or )\b/i.test(trimmed)
  );
}

function isLikelyNonCssSnippet(source: string): boolean {
  return (
    /<\/?[a-z][^>]*>/i.test(source) ||
    /["']>/.test(source) ||
    /\.{3}/.test(source) ||
    /\/\*(?![\s\S]*\*\/)/.test(source) ||
    /\b(like|equivalent to):/i.test(source) ||
    /^\s*(enum|dictionary)\s+[A-Z]\w*\s*\{/m.test(source) ||
    /\binterface\s+\w+\s*:/.test(source) ||
    /\binterface\s+\w+\s*\{/.test(source) ||
    /^\s*partial\s+(interface|dictionary|namespace)\s+[A-Z]\w*/m.test(source) ||
    /^\[[^\]]+\]\s*\n\s*interface\b/m.test(source) ||
    /\b(function|return|let|const|window|document)\b/.test(source) ||
    /@param\s*\{/.test(source) ||
    hasSmartQuoteOutsideCssString(source) ||
    hasAtKeywordBeforeTopLevelBlock(source) ||
    hasProseInDeclarationValue(source) ||
    hasRuleBlockTrailingComma(source) ||
    hasLineCommentSyntax(source) ||
    hasUnquotedTemplateVariable(source) ||
    hasAdjacentDeclarationWithoutSemicolon(source) ||
    hasConditionalGroupWithDeclarationList(source)
  );
}

function hasTopLevelBlock(source: string): boolean {
  return hasTopLevelOpeningBrace(source) && source.includes("}");
}

function isSelectorRuleStartLine(source: string): boolean {
  return /^([a-z_-][\w-]*|[.#:&[])/.test(source) && hasTopLevelOpeningBrace(source);
}

function isDeclarationSnippet(source: string): boolean {
  const match = /^(--[a-zA-Z_][\w-]*|-?[a-zA-Z_][\w-]{1,}):(?!:)([\s\S]*)/.exec(source.trim());
  if (match === null) {
    return false;
  }
  const name = match[1] ?? "";
  const valueStart = match[2]?.trimStart() ?? "";
  return (
    !selectorLikeNames.has(name.toLowerCase()) &&
    !/^(active|checked|focus|focus-visible|has\(|hover|is\(|lang\(|link|not\(|nth-|root\b|scope\b|target\b|unchecked|visited|where\()/.test(
      valueStart,
    )
  );
}

function isSelectorPreludeLine(source: string): boolean {
  const selectorPart = source.replace(/\/\*.*\*\//g, "").replace(/,\s*$/, "");
  return (
    /^([a-z_-][\w-]*|[.#:&[]|\*)/.test(source) &&
    !isDeclarationSnippet(source) &&
    /[:#[\]>+~]|\/[a-z-]+\/|\.[a-zA-Z_-]/.test(selectorPart) &&
    /,\s*(?:\/\*.*\*\/\s*)?$/.test(source)
  );
}

function wrapDeclarationSnippet(source: string): string | undefined {
  const trimmed = source.trim();
  if (!isDeclarationSnippet(trimmed)) {
    return undefined;
  }
  if (trimmed.includes("\n") && !trimmed.includes(";")) {
    return undefined;
  }
  const value = declarationValue(trimmed);
  if (value !== undefined && hasTopLevelOpeningBrace(value)) {
    return undefined;
  }
  if (hasAdjacentDeclarationWithoutSemicolon(trimmed)) {
    return undefined;
  }
  return `.spec-example { ${trimmed.endsWith(";") ? trimmed : `${trimmed};`} }`;
}

function declarationValue(source: string): string | undefined {
  return /^(?:--[a-zA-Z_][\w-]*|-?[a-zA-Z_][\w-]{1,}):(?!:)([\s\S]*)/.exec(source.trim())?.at(1);
}

function hasProseInDeclarationValue(source: string): boolean {
  const value = declarationValue(source);
  return (
    value !== undefined &&
    (/\b(?:and|or)\s+(?:has|is|are|the|a|an)\b/i.test(value) || /\.\s+[A-Z][a-z]/.test(value))
  );
}

function hasRuleBlockTrailingComma(source: string): boolean {
  return /}\s*,\s*$/.test(source.trim());
}

function hasAdjacentDeclarationWithoutSemicolon(source: string): boolean {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const current = lines[index] ?? "";
    const next = lines[index + 1] ?? "";
    if (isDeclarationSnippet(current) && isDeclarationSnippet(next) && !current.endsWith(";")) {
      return true;
    }
  }
  return false;
}

function hasConditionalGroupWithDeclarationList(source: string): boolean {
  return /@(media|supports|container|scope|layer)\b[^{]*\{\s*(?:\/\*[\s\S]*?\*\/\s*)*(--[a-zA-Z_][\w-]*|-?[a-zA-Z_][\w-]{1,})\s*:/m.test(
    source,
  );
}

function hasLineCommentSyntax(source: string): boolean {
  return source.split(/\r?\n/).some((line) => line.trimStart().startsWith("//"));
}

function hasSmartQuoteOutsideCssString(source: string): boolean {
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let inComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    const following = source.charAt(index + 1);

    if (inComment) {
      if (char === "*" && following === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "/" && following === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/[\u2018\u2019\u201c\u201d]/.test(char)) {
      return true;
    }
  }

  return false;
}

function hasAtKeywordBeforeTopLevelBlock(source: string): boolean {
  if (source.trimStart().startsWith("@")) {
    return false;
  }

  let quote: '"' | "'" | undefined;
  let escaped = false;
  let inComment = false;
  let parens = 0;
  let brackets = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    const following = source.charAt(index + 1);

    if (inComment) {
      if (char === "*" && following === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "/" && following === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") {
      parens += 1;
      continue;
    }
    if (char === ")") {
      parens -= 1;
      continue;
    }
    if (char === "[") {
      brackets += 1;
      continue;
    }
    if (char === "]") {
      brackets -= 1;
      continue;
    }
    if (char === "{" && parens === 0 && brackets === 0) {
      return false;
    }
    if (char === "@" && source.charAt(index - 1) !== "\\") {
      return true;
    }
  }

  return false;
}

function hasUnquotedTemplateVariable(source: string): boolean {
  let quote: '"' | "'" | undefined;
  let inComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    const next = source.charAt(index + 1);

    if (inComment) {
      if (char === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== undefined) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "$" && /[a-zA-Z_]/.test(next)) {
      return true;
    }
  }

  return false;
}

const selectorLikeNames = new Set([
  "a",
  "article",
  "body",
  "button",
  "div",
  "html",
  "input",
  "label",
  "li",
  "main",
  "match",
  "p",
  "q",
  "section",
  "span",
]);

function hasTopLevelOpeningBrace(source: string): boolean {
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let inComment = false;
  let parens = 0;
  let brackets = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    const following = source.charAt(index + 1);

    if (inComment) {
      if (char === "*" && following === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "/" && following === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") {
      parens += 1;
      continue;
    }
    if (char === ")") {
      parens -= 1;
      continue;
    }
    if (char === "[") {
      brackets += 1;
      continue;
    }
    if (char === "]") {
      brackets -= 1;
      continue;
    }
    if (char === "{" && parens === 0 && brackets === 0) {
      return true;
    }
  }

  return false;
}

interface DelimiterBalance {
  readonly braces: number;
  readonly brackets: number;
  readonly parens: number;
}

function addDelimiterBalance(balance: DelimiterBalance, line: string): DelimiterBalance {
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let inComment = false;
  let next = { ...balance };

  for (let index = 0; index < line.length; index += 1) {
    const char = line.charAt(index);
    const following = line.charAt(index + 1);

    if (inComment) {
      if (char === "*" && following === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "/" && following === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    next = updateDelimiterBalance(next, char);
  }

  return next;
}

function scanDelimiterBalance(source: string): DelimiterBalance {
  let balance: DelimiterBalance = { braces: 0, brackets: 0, parens: 0 };
  for (const line of source.split(/\r?\n/)) {
    balance = addDelimiterBalance(balance, line);
  }
  return balance;
}

function updateDelimiterBalance(balance: DelimiterBalance, char: string): DelimiterBalance {
  switch (char) {
    case "{":
      return { ...balance, braces: balance.braces + 1 };
    case "}":
      return { ...balance, braces: balance.braces - 1 };
    case "[":
      return { ...balance, brackets: balance.brackets + 1 };
    case "]":
      return { ...balance, brackets: balance.brackets - 1 };
    case "(":
      return { ...balance, parens: balance.parens + 1 };
    case ")":
      return { ...balance, parens: balance.parens - 1 };
    default:
      return balance;
  }
}

function isBalanced(balance: DelimiterBalance): boolean {
  return balance.braces === 0 && balance.brackets === 0 && balance.parens === 0;
}
