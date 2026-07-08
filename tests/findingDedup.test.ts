import { describe, expect, test } from "vite-plus/test";
import type { ParseResult } from "../src/core/types.js";
import { findingSourceFingerprint } from "../src/runner/differential.js";
import { findingSkipReason, knownFindingsFromReplayRows } from "../src/runner/findingDedup.js";

const results: readonly ParseResult[] = [
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

const allAcceptedResults: readonly ParseResult[] = [
  { parser: "postcss", status: "accepted", durationMs: 1 },
  { parser: "prettier-css", status: "accepted", durationMs: 1 },
  { parser: "lightningcss", status: "accepted", durationMs: 1 },
  { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
];

describe("findingSkipReason", () => {
  test("skips exact known source fingerprints", () => {
    const source = "x-tabs::part(tab active) { color: red; }";
    expect(
      findingSkipReason(
        source,
        results,
        {
          fingerprints: new Set([findingSourceFingerprint(source, results)]),
          families: new Set(),
        },
        new Set(),
      ),
    ).toBe("known");
  });

  test("skips known issue families", () => {
    expect(
      findingSkipReason(
        "x-tabs::part(tab selected) { color: red; }",
        results,
        {
          fingerprints: new Set(),
          families: new Set([
            "family:shadow-parts-multiple-ident|lightningcss:accepted|oxc-css-parser:rejected|postcss:accepted|prettier-css:accepted|oxc-css-parser:rejected:part ident list",
          ]),
        },
        new Set(),
      ),
    ).toBe("known");
  });

  test("skips minimized duplicates while ignoring the raw source itself", () => {
    const rawSource = ".wrapper { x-tabs::part(tab active) { color: red; } }";
    const minimizedSource = "x-tabs::part(tab active) { color: red; }";
    const rawFingerprint = findingSourceFingerprint(rawSource, results);
    const minimizedFingerprint = findingSourceFingerprint(minimizedSource, results);

    expect(
      findingSkipReason(
        rawSource,
        results,
        { fingerprints: new Set(), families: new Set() },
        new Set([rawFingerprint]),
        { ignoreSourceFingerprint: rawFingerprint },
      ),
    ).toBeUndefined();
    expect(
      findingSkipReason(
        minimizedSource,
        results,
        { fingerprints: new Set(), families: new Set() },
        new Set([rawFingerprint, minimizedFingerprint]),
        { ignoreSourceFingerprint: rawFingerprint },
      ),
    ).toBe("duplicate");
  });
});

describe("knownFindingsFromReplayRows", () => {
  test("only derives known fingerprints from currently interesting replay rows", () => {
    const staleSource = "a { color: red; }";
    const interestingSource = "x-tabs::part(tab active) { color: red; }";
    const known = knownFindingsFromReplayRows(
      [
        {
          file: "stale.css",
          source: staleSource,
          results: allAcceptedResults,
        },
        {
          file: "shadow-parts.css",
          source: interestingSource,
          results,
        },
      ],
      "css",
    );

    expect(known.fingerprints.has(findingSourceFingerprint(staleSource, allAcceptedResults))).toBe(
      false,
    );
    expect(known.fingerprints.has(findingSourceFingerprint(interestingSource, results))).toBe(true);
    expect(findingSkipReason(staleSource, allAcceptedResults, known, new Set())).toBeUndefined();
    expect(findingSkipReason(interestingSource, results, known, new Set())).toBe("known");
  });

  test("derives a compound known family for independent filed root causes in one source", () => {
    const known = knownFindingsFromReplayRows(
      [
        {
          file: "lc-column.css",
          source: "article || figure { color: red; }",
          results: [
            { parser: "postcss", status: "accepted", durationMs: 1 },
            { parser: "prettier-css", status: "accepted", durationMs: 1 },
            {
              parser: "lightningcss",
              status: "rejected",
              durationMs: 1,
              message: "Unexpected token in namespace selector: Delim('|')",
            },
            { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
          ],
        },
        {
          file: "oxc-container.css",
          source: "@container my-page-layout { .card { padding: 1em; } }",
          results: [
            { parser: "postcss", status: "accepted", durationMs: 1 },
            { parser: "prettier-css", status: "accepted", durationMs: 1 },
            { parser: "lightningcss", status: "accepted", durationMs: 1 },
            {
              parser: "oxc-css-parser",
              status: "rejected",
              durationMs: 1,
              message: "expect token `<ident>`, but found `{`",
            },
          ],
        },
      ],
      "css",
    );

    expect(
      findingSkipReason(
        "@container my-page-layout { .card { padding: 1em; } } .card:where([data-state='open']) || dialog { animation-timeline: --scroller; accent-color: rgb(20 40 60 / 80%); }",
        [
          { parser: "postcss", status: "accepted", durationMs: 1 },
          { parser: "prettier-css", status: "accepted", durationMs: 1 },
          {
            parser: "lightningcss",
            status: "rejected",
            durationMs: 1,
            message: "Unexpected token in namespace selector: Delim('|')",
          },
          {
            parser: "oxc-css-parser",
            status: "rejected",
            durationMs: 1,
            message: "expect token `<ident>`, but found `{`",
          },
        ],
        known,
        new Set(),
      ),
    ).toBe("known");
  });
});
