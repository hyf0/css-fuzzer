import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  assertAuditableSpecCorpus,
  normalizeSpecExample,
  readSpecCorpusAudit,
} from "../src/generator/specCorpus.js";

describe("normalizeSpecExample", () => {
  test("keeps CSS-like examples", () => {
    expect(normalizeSpecExample("a { color: red; }")).toBe("a { color: red; }");
  });

  test("keeps smart quotes inside CSS strings", () => {
    expect(normalizeSpecExample('q::before { content: "‘"; }')).toBe('q::before { content: "‘"; }');
  });

  test("drops prose-only examples", () => {
    expect(normalizeSpecExample("This is explanatory prose.")).toBeUndefined();
  });

  test("drops prose that embeds a CSS fragment inside smart quotes", () => {
    expect(
      normalizeSpecExample(
        "hard line break after the third SPAN: ‘span:nth-child(3)::after { color: red; }",
      ),
    ).toBeUndefined();
  });

  test("drops prose that mentions an at-rule before a block", () => {
    expect(normalizeSpecExample("could have an @template :first { color: red; }")).toBeUndefined();
  });

  test("keeps at-rule examples that start with the at-keyword", () => {
    expect(normalizeSpecExample("@template :first { color: red; }")).toBe(
      "@template :first { color: red; }",
    );
  });

  test("strips prose before CSS examples", () => {
    expect(
      normalizeSpecExample(`The following examples result in green:

@media (width > 10px) {
  body { background: green; }
}`),
    ).toBe(`@media (width > 10px) {
  body { background: green; }
}`);
  });

  test("drops mixed HTML examples", () => {
    expect(
      normalizeSpecExample(`#a, b {
  & c { color: blue; }
}
Then in a DOM structure like
<b class=foo>
  <c>Blue text</c>
</b>`),
    ).toBe(`#a, b {
  & c { color: blue; }
}`);
  });

  test("drops JavaScript helper snippets from specs", () => {
    expect(
      normalizeSpecExample(`* @param {number} hue
 */
function hwbToRgb(hue, white, black) {
  return [0, 0, 0];
}`),
    ).toBeUndefined();
  });

  test("drops WebIDL snippets from specs", () => {
    expect(
      normalizeSpecExample(`[Exposed=Window]
interface CSSStartingStyleRule : CSSGroupingRule {
};`),
    ).toBeUndefined();
    expect(normalizeSpecExample("interface String { };")).toBeUndefined();
    expect(
      normalizeSpecExample(`enum PointerAxis {
  "block",
  "inline",
  "x",
  "y"
};

dictionary PointerTimelineOptions {
  Element? source;
  PointerAxis axis = "block";
};`),
    ).toBeUndefined();
  });

  test("drops HTML attribute fragments", () => {
    expect(normalizeSpecExample(`color: blue;">`)).toBeUndefined();
  });

  test("drops placeholder ellipses", () => {
    expect(
      normalizeSpecExample(`.foo {
  @media (...) {...}
}`),
    ).toBeUndefined();
  });

  test("does not treat labels as declarations", () => {
    expect(normalizeSpecExample("Example:")).toBeUndefined();
  });

  test("skips uppercase language labels before CSS", () => {
    expect(
      normalizeSpecExample(`CSS:

span.footnote {
  flow-into: footnote;
}`),
    ).toBe(`span.footnote {
  flow-into: footnote;
}`);
  });

  test("does not treat selector fragments as declarations", () => {
    expect(
      normalizeSpecExample(`a:hover   /* user hovers over the link */
a:focus   /* user focuses the link     */

a:focus:hover
/* user hovers over the link while it's focused */`),
    ).toBeUndefined();
  });

  test("does not treat custom-element pseudo selectors as declarations", () => {
    expect(normalizeSpecExample("x-panel::part(confirm-button)::part(label)")).toBeUndefined();
  });

  test("does not wrap multiline selector lists without semicolons", () => {
    expect(
      normalizeSpecExample(`html:lang(fr-be)
html:lang(de)
:lang(fr-be) > q
:lang(de) > q`),
    ).toBeUndefined();
  });

  test("does not treat selector prose as a declaration", () => {
    expect(normalizeSpecExample("match :checked or :unchecked")).toBeUndefined();
  });

  test("skips prose lines that start with pseudo-class names", () => {
    expect(
      normalizeSpecExample(`:focus-visible state, and a thick red line when it is in the
:active state, the following rules can be used:

:focus-visible { outline: thick solid black }
:active { outline: thick solid red }`),
    ).toBe(`:focus-visible { outline: thick solid black }
:active { outline: thick solid red }`);
  });

  test("keeps selector rules whose first selector contains a pseudo-class", () => {
    expect(
      normalizeSpecExample(`label:is(:hover, :focus) /for/ input,
label:is(:hover, :focus):not([for]) input {
  box-shadow: yellow 0 0 10px;
}`),
    ).toBe(`label:is(:hover, :focus) /for/ input,
label:is(:hover, :focus):not([for]) input {
  box-shadow: yellow 0 0 10px;
}`);
  });

  test("skips prose lines that happen to end with commas", () => {
    expect(
      normalizeSpecExample(`declarations into one. Thus,

h1 { font-family: sans-serif }
h2 { font-family: sans-serif }`),
    ).toBe(`h1 { font-family: sans-serif }
h2 { font-family: sans-serif }`);
  });

  test("wraps declaration snippets into a stylesheet", () => {
    expect(normalizeSpecExample("color: color(display-p3 1 0 0);")).toBe(
      ".spec-example { color: color(display-p3 1 0 0); }",
    );
  });

  test("wraps declaration snippets with function argument blocks", () => {
    expect(normalizeSpecExample("font-family: random-item(--x, {Times, serif}, sans-serif);")).toBe(
      ".spec-example { font-family: random-item(--x, {Times, serif}, sans-serif); }",
    );
  });

  test("does not treat function argument blocks as rule blocks", () => {
    expect(normalizeSpecExample("random-item(--x, {Times, serif})")).toBeUndefined();
  });

  test("keeps multiline declaration snippets until delimiters close", () => {
    expect(
      normalizeSpecExample(`background: color-interpolate(100vw in lch,
  200px: palegoldenrod,
  800px: palegreen
);`),
    ).toBe(`.spec-example { background: color-interpolate(100vw in lch,
  200px: palegoldenrod,
  800px: palegreen
); }`);
  });

  test("drops snippets with unbalanced delimiters", () => {
    expect(normalizeSpecExample("background: color-interpolate(100vw in lch,")).toBeUndefined();
  });

  test("drops adjacent declaration lines when a semicolon is missing", () => {
    expect(
      normalizeSpecExample(`color: lab(45.060% 45.477 35.459)
color: rgb(70.690% 26.851% 19.724%);`),
    ).toBeUndefined();
  });

  test("drops spec pseudocode with unquoted template variables", () => {
    expect(normalizeSpecExample("table[border=$border] { border: 1px solid; }")).toBeUndefined();
  });

  test("drops snippets with JavaScript-style line comments", () => {
    expect(
      normalizeSpecExample(`@template side-by-side:first {
  @slot left {
    //fancy styling
    flow-from: article1;
  }
}`),
    ).toBeUndefined();
  });

  test("drops nested adjacent declaration lines when a semicolon is missing", () => {
    expect(
      normalizeSpecExample(`@template side-by-side {
  @slot right {
    padding: 5%
    float: right;
  }
}`),
    ).toBeUndefined();
  });

  test("stops before lowercase explanatory prose after a rule", () => {
    expect(
      normalizeSpecExample(`.container {
  display: grid-lanes;
}
while the following code explains another case:
.other { color: red; }`),
    ).toBe(`.container {
  display: grid-lanes;
}`);
  });

  test("stops before top-level declarations after a completed block", () => {
    expect(
      normalizeSpecExample(`@color-profile --unwise {
  src: url(https://example.com/unwise);
}
--base: color(--unwise 35% 20% 8%);`),
    ).toBe(`@color-profile --unwise {
  src: url(https://example.com/unwise);
}`);
  });

  test("drops conditional group rules with direct declarations", () => {
    expect(
      normalizeSpecExample(`@view-transition {
  navigation: auto;
}

@media (max-width: 600px) {
  navigation: none;
}`),
    ).toBeUndefined();
  });

  test("drops unclosed comments", () => {
    expect(normalizeSpecExample(".x { color: red; }\n/* equivalent to")).toBeUndefined();
  });

  test("drops labeled prose fragments", () => {
    expect(normalizeSpecExample("like:\nfont-family: random-item(--x, serif);")).toBeUndefined();
  });

  test("drops prose fragments that look like declarations", () => {
    expect(
      normalizeSpecExample("top: calc(150% + 30px) and has height: calc(100% - 10px). If"),
    ).toBeUndefined();
  });

  test("drops declaration-like prose before nested rule blocks", () => {
    expect(
      normalizeSpecExample(`pages:

.figure { float-reference: page; float: top; clear: top };`),
    ).toBeUndefined();
  });

  test("drops rule fragments with trailing commas after a completed block", () => {
    expect(
      normalizeSpecExample(`in .bar { inset-block-start: anchor(--foo block-start); },`),
    ).toBeUndefined();
  });
});

describe("spec corpus audit", () => {
  test("reads manifest counts from generated corpus files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-corpus-"));
    const file = path.join(dir, "examples.json");
    try {
      await writeFile(
        file,
        JSON.stringify({
          fetchedAt: "2026-07-08T00:00:00.000Z",
          selectedSlugs: ["css-color-4", "css-values-5"],
          downloadedSlugs: ["css-color-4", "css-values-5"],
          failedSpecs: [],
          examples: [{ slug: "css-color-4", source: "a { color: red; }" }],
        }),
        "utf8",
      );

      expect(readSpecCorpusAudit(file)).toEqual({
        fetchedAt: "2026-07-08T00:00:00.000Z",
        selectedSlugs: ["css-color-4", "css-values-5"],
        downloadedSlugs: ["css-color-4", "css-values-5"],
        failedSpecs: [],
        exampleCountsBySpec: new Map(),
        examples: 1,
      });
      expect(() => assertAuditableSpecCorpus(file)).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects legacy corpus files without a download manifest", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-corpus-"));
    const file = path.join(dir, "examples.json");
    try {
      await writeFile(
        file,
        JSON.stringify({
          fetchedAt: "2026-07-08T00:00:00.000Z",
          examples: [{ slug: "css-color-4", source: "a { color: red; }" }],
        }),
        "utf8",
      );

      expect(() => assertAuditableSpecCorpus(file)).toThrow("complete download manifest");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects corpus files with failed spec downloads", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-corpus-"));
    const file = path.join(dir, "examples.json");
    try {
      await writeFile(
        file,
        JSON.stringify({
          fetchedAt: "2026-07-08T00:00:00.000Z",
          selectedSlugs: ["css-color-4", "css-values-5"],
          downloadedSlugs: ["css-color-4"],
          failedSpecs: [{ slug: "css-values-5" }],
          examples: [{ slug: "css-color-4", source: "a { color: red; }" }],
        }),
        "utf8",
      );

      expect(() => assertAuditableSpecCorpus(file)).toThrow("failed spec downloads: css-values-5");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects stale corpus files when a freshness limit is configured", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-corpus-"));
    const file = path.join(dir, "examples.json");
    try {
      await writeFile(
        file,
        JSON.stringify({
          fetchedAt: "2026-07-06T00:00:00.000Z",
          selectedSlugs: ["css-color-4"],
          downloadedSlugs: ["css-color-4"],
          failedSpecs: [],
          exampleCountsBySpec: [{ slug: "css-color-4", extractedExamples: 1 }],
          examples: [{ slug: "css-color-4", source: "a { color: red; }" }],
        }),
        "utf8",
      );

      expect(() =>
        assertAuditableSpecCorpus(file, {
          maxAgeHours: 24,
          now: new Date("2026-07-08T00:00:00.000Z"),
        }),
      ).toThrow("older than the 24 hour limit");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
