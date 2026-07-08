import type {
  DifferentialFinding,
  FuzzCase,
  ParserAdapter,
  ParseContext,
  ParseResult,
} from "../core/types.js";
import { fnv1a64 } from "../core/hash.js";
import { isHardFailure, isSupported, parserStatusLabel } from "../core/types.js";

export async function runDifferentialCase(
  adapters: readonly ParserAdapter[],
  testCase: FuzzCase,
  context: ParseContext,
): Promise<DifferentialFinding> {
  const results = await Promise.all(
    adapters.map((adapter) => adapter.parse(testCase.source, context)),
  );
  return classifyFinding(testCase, results);
}

export function classifyFinding(
  testCase: FuzzCase,
  results: readonly ParseResult[],
): DifferentialFinding {
  const supported = results.filter(isSupported);
  if (supported.length === 0) {
    return {
      testCase,
      results,
      interesting: false,
      reason: "No supported parser adapters were available.",
    };
  }

  const hardFailure = supported.find(isHardFailure);
  if (hardFailure !== undefined) {
    return {
      testCase,
      results,
      interesting: true,
      reason: `${parserStatusLabel(hardFailure)} is a hard failure.`,
    };
  }

  const statuses = new Set(supported.map((item) => item.status));
  if (statuses.size > 1) {
    return {
      testCase,
      results,
      interesting: true,
      reason: `Parser status disagreement: ${supported.map(parserStatusLabel).join(", ")}.`,
    };
  }

  return {
    testCase,
    results,
    interesting: false,
    reason: `All supported parsers reported ${supported[0]?.status ?? "unknown"}.`,
  };
}

export function findingFingerprint(results: readonly ParseResult[]): string {
  return results
    .filter(isSupported)
    .map((result) => {
      const message =
        result.message === undefined ? "" : `:${normalizeMessage(firstLine(result.message))}`;
      return `${result.parser}:${result.status}${message}`;
    })
    .sort()
    .join("|");
}

export function findingSourceFingerprint(source: string, results: readonly ParseResult[]): string {
  return `${fnv1a64(normalizeSourceForFingerprint(source))}:${findingFingerprint(results)}`;
}

export function preservesFindingIdentity(
  originalSource: string,
  originalResults: readonly ParseResult[],
  candidateSource: string,
  candidateResults: readonly ParseResult[],
): boolean {
  if (findingFingerprint(candidateResults) !== findingFingerprint(originalResults)) {
    return false;
  }
  const family = findingFamilyFingerprint(originalSource, originalResults);
  return (
    family === undefined || findingFamilyFingerprint(candidateSource, candidateResults) === family
  );
}

export function findingFamilyFingerprint(
  source: string,
  results: readonly ParseResult[],
): string | undefined {
  const supported = results.filter(isSupported);
  const lightningcss = supported.find((result) => result.parser === "lightningcss");
  const oxcCssParser = supported.find((result) => result.parser === "oxc-css-parser");
  const statuses = statusFingerprint(supported);
  if (isColumnCombinatorNameOnlyContainerCrossProduct(source, lightningcss, oxcCssParser)) {
    return `family:compound:selectors-column-combinator+container-query-name-only|${statuses}|lightningcss:rejected:column-combinator|oxc-css-parser:rejected:name-only container`;
  }
  if (
    /@property\b/.test(source) &&
    lightningcss?.status === "rejected" &&
    lightningcss.message !== undefined &&
    /^Unexpected token (Function|Dimension|Number|Ident)\b/.test(lightningcss.message)
  ) {
    return `family:property-initial-value-validation|${statuses}|lightningcss:rejected:Unexpected token value`;
  }
  if (
    source.includes("||") &&
    lightningcss?.status === "rejected" &&
    lightningcss.message !== undefined &&
    /Unexpected token (CurlyBracketBlock|Delim\('\|'\)|in namespace selector: Delim\('\|'\))/.test(
      lightningcss.message,
    )
  ) {
    return `family:selectors-column-combinator|${statuses}|lightningcss:rejected:column-combinator`;
  }
  if (
    source.includes("/for/") &&
    lightningcss?.status === "rejected" &&
    lightningcss.message === "Invalid dangling combinator in selector"
  ) {
    return `family:selectors-reference-combinator|${statuses}|lightningcss:rejected:reference-combinator`;
  }
  if (
    source.includes("::before::marker") &&
    lightningcss?.status === "rejected" &&
    lightningcss.message === "Invalid state"
  ) {
    return `family:pseudo-before-marker-chain|${statuses}|lightningcss:rejected:Invalid state`;
  }
  if (
    /::part\(\s*[\w-]+\s+[\w-]/.test(source) &&
    oxcCssParser?.status === "rejected" &&
    oxcCssParser.message === "expect token `)`, but found `<ident>`"
  ) {
    return `family:shadow-parts-multiple-ident|${statuses}|oxc-css-parser:rejected:part ident list`;
  }
  if (
    /@color-profile\s+device-cmyk\b/.test(source) &&
    oxcCssParser?.status === "accepted_with_errors" &&
    oxcCssParser.message === "dashed identifier is expected"
  ) {
    return `family:color-profile-device-cmyk|${statuses}|oxc-css-parser:accepted_with_errors:dashed identifier is expected`;
  }
  if (
    /@container\b[^{]*,/.test(source) &&
    lightningcss?.status === "rejected" &&
    lightningcss.message === "Unexpected token Comma"
  ) {
    return `family:container-query-list|${statuses}|lightningcss:rejected:Unexpected token Comma`;
  }
  if (
    /@container\b[^{]*\bvar\(/.test(source) &&
    lightningcss?.status === "rejected" &&
    lightningcss.message === 'Unexpected token Function("var")'
  ) {
    return `family:container-query-var-threshold|${statuses}|lightningcss:rejected:Unexpected token Function("var")`;
  }
  if (
    /@container\s+anchored\(/.test(source) &&
    lightningcss?.status === "rejected" &&
    lightningcss.message === 'Unexpected token Function("anchored")'
  ) {
    return `family:anchor-position-anchored-container-query|${statuses}|lightningcss:rejected:Unexpected token Function("anchored")`;
  }
  if (
    /\burl\([\s\S]*\bparam\(/.test(source) &&
    lightningcss?.status === "rejected" &&
    (lightningcss.message === "Unexpected token Comma" ||
      lightningcss.message === 'Unexpected token Function("param")')
  ) {
    return `family:link-params-url-param|${statuses}|lightningcss:rejected:url param`;
  }
  if (
    /\burl\(\s*var\(/.test(source) &&
    lightningcss?.status === "rejected" &&
    lightningcss.message !== undefined &&
    lightningcss.message.startsWith("Unexpected token BadUrl(")
  ) {
    return `family:var-in-url|${statuses}|lightningcss:rejected:BadUrl(var)`;
  }
  if (
    /@scope\b[\s\S]*\{\s*>/.test(source) &&
    lightningcss?.status === "rejected" &&
    lightningcss.message === "Invalid empty selector"
  ) {
    return `family:scope-relative-selector|${statuses}|lightningcss:rejected:Invalid empty selector`;
  }
  if (
    /@scope\s*\(\s*\)/.test(source) &&
    oxcCssParser?.status === "rejected" &&
    oxcCssParser.message === "simple selector is expected"
  ) {
    return `family:scope-empty-root|${statuses}|oxc-css-parser:rejected:simple selector is expected`;
  }
  if (
    /@container\s+[^{(]+\{/.test(source) &&
    oxcCssParser?.status === "rejected" &&
    oxcCssParser.message === "expect token `<ident>`, but found `{`"
  ) {
    return `family:container-query-name-only|${statuses}|oxc-css-parser:rejected:name-only container`;
  }
  if (
    /@import\b/.test(source) &&
    lightningcss?.status === "rejected" &&
    lightningcss.message ===
      "@import rules must precede all rules aside from @charset and @layer statements"
  ) {
    return `family:late-import-order|${statuses}|lightningcss:rejected:late import`;
  }
  if (
    source.includes("..") &&
    lightningcss?.status === "rejected" &&
    lightningcss.message === "Expected identifier in class selector, got Delim('.')"
  ) {
    return `family:invalid-double-class-dot|${statuses}|lightningcss:rejected:double class dot`;
  }
  if (
    /@media\b[^{};]*;/.test(source) &&
    lightningcss?.status === "rejected" &&
    lightningcss.message === "Unexpected token Semicolon" &&
    (oxcCssParser === undefined ||
      oxcCssParser.status !== "rejected" ||
      oxcCssParser.message === "expect token `{`, but found `;`")
  ) {
    return `family:invalid-media-query-list-recovery|${statuses}|lightningcss:rejected:Unexpected token Semicolon`;
  }
  if (
    /@media\b/.test(source) &&
    lightningcss?.status === "rejected" &&
    lightningcss.message === "Unexpected token Comma" &&
    oxcCssParser?.status === "rejected" &&
    oxcCssParser.message === "expect token `<ident>`, but found `&`"
  ) {
    return `family:invalid-media-query-list-comma-recovery|${statuses}|lightningcss:rejected:Unexpected token Comma`;
  }
  if (
    /var\(\s*var\(/.test(source) &&
    lightningcss?.status === "rejected" &&
    lightningcss.message === 'Unexpected token Function("var")'
  ) {
    return `family:nested-var-reference|${statuses}|lightningcss:rejected:Unexpected token Function("var")`;
  }
  if (
    /\bvar\([^)]*\)\s*:/.test(source) &&
    lightningcss?.status === "rejected" &&
    lightningcss.message === "Unexpected token Semicolon"
  ) {
    return `family:invalid-dynamic-property-name|${statuses}|lightningcss:rejected:Unexpected token Semicolon`;
  }
  if (
    /\bfont-family\s*:/.test(source) &&
    lightningcss?.status === "rejected" &&
    lightningcss.message === "Unexpected token Delim('!')"
  ) {
    return `family:invalid-font-family-punctuation|${statuses}|lightningcss:rejected:Unexpected token Delim('!')`;
  }
  if (
    /@page::slot\(/.test(source) &&
    lightningcss?.status === "rejected" &&
    lightningcss.message === "Unexpected token Colon"
  ) {
    return `family:page-slot-pseudo|${statuses}|lightningcss:rejected:Unexpected token Colon`;
  }
  if (
    /@page\b[\s\S]*@slot\b/.test(source) &&
    lightningcss?.status === "rejected" &&
    lightningcss.message === "Unknown at rule: @slot"
  ) {
    return `family:page-slot-rule|${statuses}|lightningcss:rejected:Unknown at rule: @slot`;
  }
  if (
    /@page\b[\s\S]*@top\b/.test(source) &&
    lightningcss?.status === "rejected" &&
    lightningcss.message === "Unknown at rule: @top"
  ) {
    return `family:page-top-margin-rule|${statuses}|lightningcss:rejected:Unknown at rule: @top`;
  }
  if (
    /@keyframes\b[\s\S]*\b(?:entry|exit)\s+\d+%/.test(source) &&
    oxcCssParser?.status === "rejected" &&
    oxcCssParser.message === "expect token `:`, but found `<percentage>`"
  ) {
    return `family:scroll-driven-keyframe-range|${statuses}|oxc-css-parser:rejected:keyframe range`;
  }
  return undefined;
}

function isColumnCombinatorNameOnlyContainerCrossProduct(
  source: string,
  lightningcss: ParseResult | undefined,
  oxcCssParser: ParseResult | undefined,
): boolean {
  return (
    source.includes("||") &&
    /@container\s+[^{(]+\{/.test(source) &&
    lightningcss?.status === "rejected" &&
    lightningcss.message !== undefined &&
    /Unexpected token (CurlyBracketBlock|Delim\('\|'\)|in namespace selector: Delim\('\|'\))/.test(
      lightningcss.message,
    ) &&
    oxcCssParser?.status === "rejected" &&
    oxcCssParser.message === "expect token `<ident>`, but found `{`"
  );
}

function statusFingerprint(results: readonly ParseResult[]): string {
  return results
    .map((result) => `${result.parser}:${result.status}`)
    .sort()
    .join("|");
}

function firstLine(value: string): string {
  return value.split("\n")[0] ?? value;
}

function normalizeMessage(value: string): string {
  return value
    .replaceAll(/<css input>:\d+:\d+: /g, "<css input>:")
    .replaceAll(/\(\d+:\d+\)/g, "(line:column)")
    .replaceAll(/\bline \d+, column \d+\b/gi, "line:column")
    .trim();
}

function normalizeSourceForFingerprint(source: string): string {
  return source.replaceAll(/\r\n?/g, "\n").trim();
}
