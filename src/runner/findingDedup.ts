import type { CssSyntax, ParseResult } from "../core/types.js";
import {
  classifyFinding,
  findingFamilyFingerprint,
  findingSourceFingerprint,
} from "./differential.js";

export interface KnownFindingFingerprints {
  readonly fingerprints: ReadonlySet<string>;
  readonly families: ReadonlySet<string>;
}

export interface KnownFindingReplayRow {
  readonly file: string;
  readonly source: string;
  readonly results: readonly ParseResult[];
}

export function knownFindingsFromReplayRows(
  rows: readonly KnownFindingReplayRow[],
  syntax: CssSyntax,
): KnownFindingFingerprints {
  const interestingRows = rows.filter(
    (row) =>
      classifyFinding(
        {
          id: row.file,
          seed: row.file,
          syntax,
          source: row.source,
          tags: ["known-dir"],
          specRefs: [],
        },
        row.results,
      ).interesting,
  );
  const families = new Set(
    interestingRows
      .map((row) => findingFamilyFingerprint(row.source, row.results))
      .filter((family): family is string => family !== undefined),
  );
  addDerivedCompoundFamilies(families);
  return {
    fingerprints: new Set(
      interestingRows.map((row) => findingSourceFingerprint(row.source, row.results)),
    ),
    families,
  };
}

export function mergeKnownFindings(
  ...items: readonly KnownFindingFingerprints[]
): KnownFindingFingerprints {
  return {
    fingerprints: new Set(items.flatMap((item) => [...item.fingerprints])),
    families: new Set(items.flatMap((item) => [...item.families])),
  };
}

export function findingSkipReason(
  source: string,
  results: readonly ParseResult[],
  knownFindings: KnownFindingFingerprints,
  seenFindings: ReadonlySet<string>,
  options: { readonly ignoreSourceFingerprint?: string } = {},
): "known" | "duplicate" | undefined {
  const family = findingFamilyFingerprint(source, results);
  const sourceFingerprint = findingSourceFingerprint(source, results);
  if (
    knownFindings.fingerprints.has(sourceFingerprint) ||
    (family !== undefined && knownFindings.families.has(family))
  ) {
    return "known";
  }
  if (
    sourceFingerprint !== options.ignoreSourceFingerprint &&
    seenFindings.has(sourceFingerprint)
  ) {
    return "duplicate";
  }
  return undefined;
}

function addDerivedCompoundFamilies(families: Set<string>): void {
  const hasColumnCombinator = [...families].some((family) =>
    family.startsWith(
      "family:selectors-column-combinator|lightningcss:rejected|oxc-css-parser:accepted|postcss:accepted|prettier-css:accepted|",
    ),
  );
  const hasNameOnlyContainer = [...families].some((family) =>
    family.startsWith(
      "family:container-query-name-only|lightningcss:accepted|oxc-css-parser:rejected|postcss:accepted|prettier-css:accepted|",
    ),
  );
  if (hasColumnCombinator && hasNameOnlyContainer) {
    families.add(
      "family:compound:selectors-column-combinator+container-query-name-only|lightningcss:rejected|oxc-css-parser:rejected|postcss:accepted|prettier-css:accepted|lightningcss:rejected:column-combinator|oxc-css-parser:rejected:name-only container",
    );
  }
}
