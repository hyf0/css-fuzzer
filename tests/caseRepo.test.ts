import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  caseRepoVerificationPassed,
  diffCaseCoverage,
  diffCaseNoteCoverage,
  extractFirstCssFence,
  extractReadmeCaseExpectations,
  extractReadmeCaseIds,
  extractReadmeCaseLinks,
  extractReadmeCasePriorities,
  extractSidecarCaseExpectations,
  findDuplicateReadmeCaseIds,
  findDuplicateReadmeCaseLinks,
  findReducibleReplayRows,
  findReadmeCaseIdPathMismatches,
  findReadmeLinksWithoutPriority,
  findReadmeLinksWithoutMatrix,
  findReadmeMatrixMismatches,
  findReadmePriorityPathMismatches,
  findReadmeRowsMissingParserMessages,
  findReadmeRowsMissingParserExpectations,
  findSidecarHeadingMismatches,
  findSidecarContextMismatches,
  findSidecarMatrixMismatches,
  findSidecarRowsMissingParserMessages,
  findSidecarRowsMissingParserExpectations,
  findSidecarSourceMismatches,
  findSidecarTitleIdMismatches,
  findUninterestingReplayRows,
  formatCaseRepoVerification,
} from "../src/runner/caseRepo.js";
import type { ParserAdapter } from "../src/core/types.js";

describe("case repo verification", () => {
  test("extracts unique README case link targets", () => {
    expect(
      extractReadmeCaseLinks(`
| A | [\`cases/high/a.css\`](./cases/high/a.css) |
| B | [label](cases/medium/b.css#notes) |
| External | [skip](https://example.com/not-a-case.css) |
`),
    ).toEqual(["cases/high/a.css", "cases/medium/b.css"]);
  });

  test("finds duplicate README case links", () => {
    expect(
      findDuplicateReadmeCaseLinks(`
| A | [\`cases/high/a.css\`](./cases/high/a.css) |
| Again | [a](cases/high/a.css#notes) |
| B | [\`cases/medium/b.css\`](./cases/medium/b.css) |
`),
    ).toEqual(["cases/high/a.css"]);
  });

  test("finds duplicate README case IDs", () => {
    const readme = `
## High Priority

| ID | Area | Minimal case |
| --- | --- | --- |
| CASE-001 | Area | [\`cases/high/a.css\`](./cases/high/a.css) |
| CASE-001 | Other | [\`cases/high/b.css\`](./cases/high/b.css) |
| CASE-002 | Other | [\`cases/high/c.css\`](./cases/high/c.css) |
`;

    expect(extractReadmeCaseIds(readme)).toEqual([
      { id: "CASE-001", file: "cases/high/a.css" },
      { id: "CASE-001", file: "cases/high/b.css" },
      { id: "CASE-002", file: "cases/high/c.css" },
    ]);
    expect(findDuplicateReadmeCaseIds(readme)).toEqual([
      { id: "CASE-001", files: ["cases/high/a.css", "cases/high/b.css"] },
    ]);
  });

  test("ignores non-case README tables when collecting case IDs", () => {
    expect(
      extractReadmeCaseIds(`
| ID | Meaning |
| --- | --- |
| NOT-A-CASE | No CSS link here. |
`),
    ).toEqual([]);
  });

  test("flags README case IDs whose file names do not start with the ID slug", () => {
    expect(
      findReadmeCaseIdPathMismatches([
        { id: "LC-SEL-001", file: "cases/high/selectors/lc-sel-001-column-combinator.css" },
        { id: "OXC-COLOR-001", file: "cases/high/at-rules/oxc-color-001.css" },
        { id: "LC-PROP-001", file: "cases/medium/at-rules/property-validation.css" },
      ]),
    ).toEqual([
      {
        id: "LC-PROP-001",
        file: "cases/medium/at-rules/property-validation.css",
        expectedBasenamePrefix: "lc-prop-001",
        actualBasename: "property-validation",
      },
    ]);
  });

  test("extracts README case priority groups", () => {
    const priorities = extractReadmeCasePriorities(`
## High Priority

| ID | Minimal case |
| --- | --- |
| A | [\`cases/high/a.css\`](./cases/high/a.css) |

## Notes

- [untriaged](./cases/low/untriaged.css)

## Low Priority

| ID | Minimal case |
| --- | --- |
| B | [\`cases/low/b.css\`](./cases/low/b.css) |
`);

    expect(priorities).toEqual([
      { file: "cases/high/a.css", priority: "High Priority" },
      { file: "cases/low/b.css", priority: "Low Priority" },
      { file: "cases/low/untriaged.css" },
    ]);
    expect(findReadmeLinksWithoutPriority(priorities)).toEqual(["cases/low/untriaged.css"]);
    expect(findReadmePriorityPathMismatches(priorities)).toEqual([]);
  });

  test("flags README priority sections that disagree with case paths", () => {
    const priorities = extractReadmeCasePriorities(`
## High Priority

| ID | Minimal case |
| --- | --- |
| A | [\`cases/medium/a.css\`](./cases/medium/a.css) |
`);

    expect(findReadmePriorityPathMismatches(priorities)).toEqual([
      {
        file: "cases/medium/a.css",
        priority: "High Priority",
        expectedPrefix: "cases/high/",
      },
    ]);
  });

  test("reports missing README coverage and stale links", () => {
    expect(
      diffCaseCoverage(
        ["cases/high/a.css", "cases/medium/b.css"],
        ["cases/high/a.css", "cases/low/c.css"],
      ),
    ).toEqual({
      missingFromReadme: ["cases/medium/b.css"],
      missingOnDisk: ["cases/low/c.css"],
    });
  });

  test("reports missing and orphaned case sidecar notes", () => {
    expect(
      diffCaseNoteCoverage(
        ["cases/high/a.css", "cases/medium/b.css"],
        ["cases/high/a.md", "cases/low/orphan.md"],
      ),
    ).toEqual({
      missingCaseNotes: ["cases/medium/b.md"],
      orphanCaseNotes: ["cases/low/orphan.md"],
    });
  });

  test("extracts css fenced blocks from sidecar notes", () => {
    expect(
      extractFirstCssFence(`
# Case

\`\`\`css
a { color: red; }
\`\`\`
`),
    ).toBe("a { color: red; }");
    expect(extractFirstCssFence("```js\nconsole.log(1);\n```")).toBeUndefined();
  });

  test("reports sidecar notes whose reproduction does not match the case file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-case-note-"));
    const caseFile = path.join(dir, "a.css");
    const noteFile = path.join(dir, "a.md");
    try {
      await writeFile(caseFile, "a { color: red; }\n", "utf8");
      await writeFile(noteFile, "```css\na { color: red; }\n```\n", "utf8");
      await expect(findSidecarSourceMismatches([caseFile], dir)).resolves.toEqual([]);

      await writeFile(noteFile, "```css\na { color: blue; }\n```\n", "utf8");
      await expect(findSidecarSourceMismatches([caseFile], dir)).resolves.toEqual([
        {
          file: "a.css",
          noteFile: "a.md",
          reason: "css fenced block does not match case source",
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports sidecar notes missing required report headings", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-case-note-"));
    const goodNote = path.join(dir, "good.md");
    const badNote = path.join(dir, "bad.md");
    try {
      await writeFile(
        goodNote,
        [
          "# GOOD",
          "",
          "## Minimal Reproduction",
          "",
          "```css",
          "a { color: red; }",
          "```",
          "",
          "## Parser Results",
          "",
          "| Parser | Result |",
          "| --- | --- |",
          "| postcss | accepts |",
          "",
          "## Spec Context",
          "",
          "This is current CSS syntax.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        badNote,
        ["# BAD", "", "## Minimal Reproduction", "", "```css", "a { color: red; }", "```", ""].join(
          "\n",
        ),
        "utf8",
      );

      await expect(findSidecarHeadingMismatches([goodNote, badNote], dir)).resolves.toEqual([
        {
          noteFile: "bad.md",
          missingHeadings: ["Parser Results", "Spec Context or Triage Note"],
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports sidecar notes whose context sections have no body", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-case-note-"));
    const goodNote = path.join(dir, "good.md");
    const emptyContextNote = path.join(dir, "empty-context.md");
    const noContextHeadingNote = path.join(dir, "no-context-heading.md");
    try {
      await writeFile(
        goodNote,
        ["# GOOD", "", "## Spec Context", "", "This is current CSS syntax.", ""].join("\n"),
        "utf8",
      );
      await writeFile(
        emptyContextNote,
        ["# EMPTY", "", "## Spec Context", "", "## Parser Results", ""].join("\n"),
        "utf8",
      );
      await writeFile(noContextHeadingNote, "# NO-CONTEXT\n", "utf8");

      await expect(
        findSidecarContextMismatches([goodNote, emptyContextNote, noContextHeadingNote], dir),
      ).resolves.toEqual([
        {
          noteFile: "empty-context.md",
          reason: "missing non-empty Spec Context or Triage Note body",
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports sidecar title IDs that do not match README case IDs", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-case-note-"));
    const goodNote = path.join(dir, "good.md");
    const missingTitleIdNote = path.join(dir, "missing-title.md");
    const mismatchNote = path.join(dir, "mismatch.md");
    const missingReadmeIdNote = path.join(dir, "missing-readme.md");
    try {
      await writeFile(goodNote, "# GOOD-001: matching title\n", "utf8");
      await writeFile(missingTitleIdNote, "# Missing title ID\n", "utf8");
      await writeFile(mismatchNote, "# OTHER-001: mismatched title\n", "utf8");
      await writeFile(missingReadmeIdNote, "# MISSING-README-001: no README row\n", "utf8");

      await expect(
        findSidecarTitleIdMismatches(
          [goodNote, missingTitleIdNote, mismatchNote, missingReadmeIdNote],
          dir,
          [
            { id: "GOOD-001", file: "good.css" },
            { id: "MISSING-TITLE-001", file: "missing-title.css" },
            { id: "MISMATCH-001", file: "mismatch.css" },
          ],
        ),
      ).resolves.toEqual([
        {
          file: "mismatch.css",
          noteFile: "mismatch.md",
          expectedId: "MISMATCH-001",
          actualId: "OTHER-001",
          reason: "sidecar title ID does not match README case ID",
        },
        {
          file: "missing-readme.css",
          noteFile: "missing-readme.md",
          actualId: "MISSING-README-001",
          reason: "missing README case ID",
        },
        {
          file: "missing-title.css",
          noteFile: "missing-title.md",
          expectedId: "MISSING-TITLE-001",
          reason: "missing sidecar title ID",
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("extracts sidecar parser expectations from parser result tables", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-sidecar-matrix-"));
    const noteFile = path.join(dir, "a.md");
    try {
      await writeFile(
        noteFile,
        [
          "# CASE",
          "",
          "## Minimal Reproduction",
          "",
          "```css",
          "a || b { color: red; }",
          "```",
          "",
          "## Parser Results",
          "",
          "| Parser | Result |",
          "| --- | --- |",
          "| postcss 8.5.16 | accepts |",
          "| prettier CSS parser 3.9.4 | accepts |",
          "| lightningcss 1.32.0 | rejects: `Unexpected token in namespace selector: Delim('|')` |",
          "| oxc-css-parser 0.0.5 (`e4c405e`) | rejects: `` expect token `<ident>`, but found `{` | still one cell `` |",
          "",
          "## Triage Note",
          "",
          "The table contains markdown-sensitive parser messages.",
          "",
        ].join("\n"),
        "utf8",
      );

      const expectations = await extractSidecarCaseExpectations([noteFile], dir);
      expect(expectations).toHaveLength(1);
      expect(expectations[0]?.file).toBe("a.css");
      expect(expectations[0]?.noteFile).toBe("a.md");
      expect(expectations[0]?.parsers.get("lightningcss")).toEqual({
        status: "rejected",
        messageSnippet: "Unexpected token in namespace selector: Delim('|')",
      });
      expect(expectations[0]?.parsers.get("oxc-css-parser")).toEqual({
        status: "rejected",
        messageSnippet: "expect token <ident>, but found { | still one cell",
      });
      expect(findSidecarRowsMissingParserExpectations(expectations)).toEqual([]);
      expect(findSidecarRowsMissingParserMessages(expectations)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("flags sidecar parser result tables with missing parser expectations", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-sidecar-matrix-"));
    const noteFile = path.join(dir, "a.md");
    try {
      await writeFile(
        noteFile,
        [
          "# CASE",
          "",
          "## Parser Results",
          "",
          "| Parser | Result |",
          "| --- | --- |",
          "| postcss 8.5.16 | accepts |",
          "",
        ].join("\n"),
        "utf8",
      );

      const expectations = await extractSidecarCaseExpectations([noteFile], dir);
      expect(findSidecarRowsMissingParserExpectations(expectations)).toEqual([
        { file: "a.css", noteFile: "a.md", parser: "prettier-css" },
        { file: "a.css", noteFile: "a.md", parser: "lightningcss" },
        { file: "a.css", noteFile: "a.md", parser: "oxc-css-parser" },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("flags sidecar parser result tables with bare error statuses", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-sidecar-matrix-"));
    const noteFile = path.join(dir, "a.md");
    try {
      await writeFile(
        noteFile,
        [
          "# CASE",
          "",
          "## Parser Results",
          "",
          "| Parser | Result |",
          "| --- | --- |",
          "| postcss 8.5.16 | accepts |",
          "| prettier CSS parser 3.9.4 | crashes |",
          "| lightningcss 1.32.0 | rejects |",
          "| oxc-css-parser 0.0.5 (`e4c405e`) | accepts with errors |",
          "",
        ].join("\n"),
        "utf8",
      );

      const expectations = await extractSidecarCaseExpectations([noteFile], dir);
      expect(findSidecarRowsMissingParserMessages(expectations)).toEqual([
        { file: "a.css", noteFile: "a.md", parser: "prettier-css", status: "crashed" },
        { file: "a.css", noteFile: "a.md", parser: "lightningcss", status: "rejected" },
        {
          file: "a.css",
          noteFile: "a.md",
          parser: "oxc-css-parser",
          status: "accepted_with_errors",
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("matches sidecar parser result tables against replay rows", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-sidecar-matrix-"));
    const noteFile = path.join(dir, "a.md");
    try {
      await writeFile(
        noteFile,
        [
          "# CASE",
          "",
          "## Parser Results",
          "",
          "| Parser | Result |",
          "| --- | --- |",
          "| postcss 8.5.16 | accepts |",
          "| prettier CSS parser 3.9.4 | accepts |",
          '| lightningcss 1.32.0 | rejects: `Unexpected token Dimension ... unit: "cqi"` |',
          "| oxc-css-parser 0.0.5 (`e4c405e`) | accepts |",
          "",
        ].join("\n"),
        "utf8",
      );

      const expectations = await extractSidecarCaseExpectations([noteFile], dir);
      expect(
        findSidecarMatrixMismatches(expectations, [
          {
            file: "a.css",
            source: "@property --x {}",
            results: [
              { parser: "postcss", status: "accepted", durationMs: 1 },
              { parser: "prettier-css", status: "accepted", durationMs: 1 },
              {
                parser: "lightningcss",
                status: "rejected",
                durationMs: 1,
                message: 'Unexpected token Dimension { has_sign: false, value: 2.0, unit: "cqi" }',
              },
              { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
            ],
          },
        ]),
      ).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports sidecar parser result table mismatches", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-sidecar-matrix-"));
    const noteFile = path.join(dir, "a.md");
    try {
      await writeFile(
        noteFile,
        [
          "# CASE",
          "",
          "## Parser Results",
          "",
          "| Parser | Result |",
          "| --- | --- |",
          "| postcss 8.5.16 | accepts |",
          "| prettier CSS parser 3.9.4 | accepts |",
          "| lightningcss 1.32.0 | rejects: `bad` |",
          "| oxc-css-parser 0.0.5 (`e4c405e`) | accepts |",
          "",
        ].join("\n"),
        "utf8",
      );

      const expectations = await extractSidecarCaseExpectations([noteFile], dir);
      expect(
        findSidecarMatrixMismatches(expectations, [
          {
            file: "a.css",
            source: "a{}",
            results: [
              { parser: "postcss", status: "accepted", durationMs: 1 },
              { parser: "prettier-css", status: "accepted", durationMs: 1 },
              { parser: "lightningcss", status: "accepted", durationMs: 1 },
              { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
            ],
          },
        ]),
      ).toEqual([
        {
          file: "a.css",
          noteFile: "a.md",
          parser: "lightningcss",
          expected: "rejected: bad",
          actual: "accepted",
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("extracts README parser expectations from case tables", () => {
    const expectations = extractReadmeCaseExpectations(`
| ID | Area | Minimal case | Why it matters | postcss | prettier CSS parser | lightningcss | oxc-css-parser |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LC-SEL-001 | Selectors | [\`cases/high/a.css\`](./cases/high/a.css) | \`||\` stays in prose | accepts | accepts | rejects: \`Unexpected token in namespace selector: Delim('|')\` | accepts |
| OXC-COLOR-001 | Color | [\`cases/high/b.css\`](./cases/high/b.css) | Recoverable parser error. | accepts | accepts | accepts | accepts with errors: \`dashed identifier is expected\` |
`);

    expect(expectations).toHaveLength(2);
    expect(expectations[0]?.file).toBe("cases/high/a.css");
    expect(expectations[0]?.parsers.get("lightningcss")).toEqual({
      status: "rejected",
      messageSnippet: "Unexpected token in namespace selector: Delim('|')",
    });
    expect(expectations[1]?.file).toBe("cases/high/b.css");
    expect(expectations[1]?.parsers.get("oxc-css-parser")).toEqual({
      status: "accepted_with_errors",
      messageSnippet: "dashed identifier is expected",
    });
    expect(
      findReadmeLinksWithoutMatrix(["cases/high/a.css", "cases/high/b.css"], expectations),
    ).toEqual([]);
    expect(
      findReadmeLinksWithoutMatrix(
        ["cases/high/a.css", "cases/high/b.css", "cases/high/c.css"],
        expectations,
      ),
    ).toEqual(["cases/high/c.css"]);
    expect(findReadmeRowsMissingParserExpectations(expectations)).toEqual([]);
    expect(findReadmeRowsMissingParserMessages(expectations)).toEqual([]);
  });

  test("extracts README parser expectations from double-backtick code spans", () => {
    const expectations = extractReadmeCaseExpectations(`
| ID | Area | Minimal case | Why it matters | postcss | prettier CSS parser | lightningcss | oxc-css-parser |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CASE | Selectors | [\`cases/high/a.css\`](./cases/high/a.css) | Message contains markdown-sensitive punctuation. | accepts | accepts | rejects: \`Unexpected token in namespace selector: Delim('|')\` | rejects: \`\` expect token \`<ident>\`, but found \`{\` | still one cell \`\` |
`);

    expect(expectations).toHaveLength(1);
    expect(expectations[0]?.parsers.get("lightningcss")).toEqual({
      status: "rejected",
      messageSnippet: "Unexpected token in namespace selector: Delim('|')",
    });
    expect(expectations[0]?.parsers.get("oxc-css-parser")).toEqual({
      status: "rejected",
      messageSnippet: "expect token <ident>, but found { | still one cell",
    });
    expect(findReadmeRowsMissingParserExpectations(expectations)).toEqual([]);
    expect(findReadmeRowsMissingParserMessages(expectations)).toEqual([]);
  });

  test("flags README parser matrix rows with missing parser expectations", () => {
    const expectations = extractReadmeCaseExpectations(`
| ID | Area | Minimal case | Why it matters | postcss | prettier CSS parser | lightningcss | oxc-css-parser |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CASE | Area | [\`cases/high/a.css\`](./cases/high/a.css) | Reason. | accepts | accepts | rejects |
`);

    expect(findReadmeRowsMissingParserExpectations(expectations)).toEqual([
      { file: "cases/high/a.css", parser: "oxc-css-parser" },
    ]);
  });

  test("flags README parser matrix rows with bare error statuses", () => {
    const expectations = extractReadmeCaseExpectations(`
| ID | Area | Minimal case | Why it matters | postcss | prettier CSS parser | lightningcss | oxc-css-parser |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CASE | Area | [\`cases/high/a.css\`](./cases/high/a.css) | Reason. | accepts | crashes | rejects | accepts with errors |
`);

    expect(findReadmeRowsMissingParserMessages(expectations)).toEqual([
      { file: "cases/high/a.css", parser: "prettier-css", status: "crashed" },
      { file: "cases/high/a.css", parser: "lightningcss", status: "rejected" },
      { file: "cases/high/a.css", parser: "oxc-css-parser", status: "accepted_with_errors" },
    ]);
  });

  test("matches README parser matrix against replay rows", () => {
    const expectations = extractReadmeCaseExpectations(`
| ID | Area | Minimal case | Why it matters | postcss | prettier CSS parser | lightningcss | oxc-css-parser |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LC-PROP-003 | Property | [\`cases/medium/a.css\`](./cases/medium/a.css) | Descriptor validation. | accepts | accepts | rejects: \`Unexpected token Dimension ... unit: "cqi"\` | accepts |
`);

    expect(
      findReadmeMatrixMismatches(expectations, [
        {
          file: "cases/medium/a.css",
          source: "@property --x {}",
          results: [
            { parser: "postcss", status: "accepted", durationMs: 1 },
            { parser: "prettier-css", status: "accepted", durationMs: 1 },
            {
              parser: "lightningcss",
              status: "rejected",
              durationMs: 1,
              message: 'Unexpected token Dimension { has_sign: false, value: 2.0, unit: "cqi" }',
            },
            { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
          ],
        },
      ]),
    ).toEqual([]);
  });

  test("reports README parser matrix mismatches", () => {
    const expectations = extractReadmeCaseExpectations(`
| ID | Area | Minimal case | Why it matters | postcss | prettier CSS parser | lightningcss | oxc-css-parser |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CASE | Area | [\`cases/high/a.css\`](./cases/high/a.css) | Reason. | accepts | accepts | rejects: \`bad\` | accepts |
`);

    expect(
      findReadmeMatrixMismatches(expectations, [
        {
          file: "cases/high/a.css",
          source: "a{}",
          results: [
            { parser: "postcss", status: "accepted", durationMs: 1 },
            { parser: "prettier-css", status: "accepted", durationMs: 1 },
            { parser: "lightningcss", status: "accepted", durationMs: 1 },
            { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
          ],
        },
      ]),
    ).toEqual([
      {
        file: "cases/high/a.css",
        parser: "lightningcss",
        expected: "rejected: bad",
        actual: "accepted",
      },
    ]);
  });

  test("flags replay rows that no longer disagree", () => {
    expect(
      findUninterestingReplayRows(
        [
          {
            file: "/repo/cases/a.css",
            source: "a { color: red; }",
            results: [
              { parser: "postcss", status: "accepted", durationMs: 1 },
              { parser: "prettier-css", status: "accepted", durationMs: 1 },
            ],
          },
          {
            file: "/repo/cases/b.css",
            source: "b { color: red; }",
            results: [
              { parser: "postcss", status: "accepted", durationMs: 1 },
              { parser: "lightningcss", status: "rejected", durationMs: 1, message: "bad" },
            ],
          },
        ],
        "css",
      ),
    ).toEqual([
      {
        file: "/repo/cases/a.css",
        reason: "All supported parsers reported accepted.",
        fingerprint: "postcss:accepted|prettier-css:accepted",
        results: [
          { parser: "postcss", status: "accepted", durationMs: 1 },
          { parser: "prettier-css", status: "accepted", durationMs: 1 },
        ],
      },
    ]);
  });

  test("flags replay rows that can still be reduced with the same fingerprint", async () => {
    const adapters: readonly ParserAdapter[] = [
      {
        name: "postcss",
        parse: async () => ({ parser: "postcss", status: "accepted", durationMs: 1 }),
      },
      {
        name: "lightningcss",
        parse: async (source) => ({
          parser: "lightningcss",
          status: source.includes("b") ? "rejected" : "accepted",
          durationMs: 1,
          ...(source.includes("b") ? { message: "bad" } : {}),
        }),
      },
    ];

    const reducible = await findReducibleReplayRows(
      [
        {
          file: "cases/high/a.css",
          source: "a { color: red; }\nb { color: blue; }",
          results: [
            { parser: "postcss", status: "accepted", durationMs: 1 },
            { parser: "lightningcss", status: "rejected", durationMs: 1, message: "bad" },
          ],
        },
      ],
      {
        adapters,
        syntax: "css",
        timeoutMs: 100,
        maxAttempts: 20,
        allowByteLevel: false,
      },
    );

    expect(reducible).toEqual([
      {
        file: "cases/high/a.css",
        originalBytes: 36,
        reducedBytes: 17,
        attempts: 4,
        reducedSource: "b { color: red; }",
      },
    ]);
  });

  test("does not reduce known-family cases to unrelated same-fingerprint inputs", async () => {
    const adapters: readonly ParserAdapter[] = [
      {
        name: "postcss",
        parse: async () => ({ parser: "postcss", status: "accepted", durationMs: 1 }),
      },
      {
        name: "prettier-css",
        parse: async () => ({ parser: "prettier-css", status: "accepted", durationMs: 1 }),
      },
      {
        name: "lightningcss",
        parse: async () => ({ parser: "lightningcss", status: "accepted", durationMs: 1 }),
      },
      {
        name: "oxc-css-parser",
        parse: async () => ({
          parser: "oxc-css-parser",
          status: "accepted_with_errors",
          durationMs: 1,
          message: "dashed identifier is expected",
        }),
      },
    ];

    const reducible = await findReducibleReplayRows(
      [
        {
          file: "cases/high/color.css",
          source: "@color-profile device-cmyk",
          results: [
            { parser: "postcss", status: "accepted", durationMs: 1 },
            { parser: "prettier-css", status: "accepted", durationMs: 1 },
            { parser: "lightningcss", status: "accepted", durationMs: 1 },
            {
              parser: "oxc-css-parser",
              status: "accepted_with_errors",
              durationMs: 1,
              message: "dashed identifier is expected",
            },
          ],
        },
      ],
      {
        adapters,
        syntax: "css",
        timeoutMs: 100,
        maxAttempts: 80,
        allowByteLevel: true,
      },
    );

    expect(reducible).toEqual([]);
  });

  test("formats a passing verification summary", () => {
    const result = {
      caseFiles: ["cases/high/a.css"],
      caseNoteFiles: ["cases/high/a.md"],
      readmeLinks: ["cases/high/a.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: false,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(true);
    expect(formatCaseRepoVerification(result)).toBe(
      "Checked 1 CSS case files, 1 sidecar notes, and 1 README case links.\nAll case files have sidecar notes with matching CSS reproduction blocks, required headings with explanatory text, README-matching title IDs, and complete parser result tables with error-message snippets, are covered by unique README links and IDs, use case filenames matching their README IDs, are listed under matching priority sections, have complete README parser matrix rows with error-message snippets, still replay as interesting, match the README and sidecar parser matrices.\n",
    );
  });

  test("formats duplicate README case links as verification failures", () => {
    const result = {
      caseFiles: ["cases/high/a.css"],
      caseNoteFiles: ["cases/high/a.md"],
      readmeLinks: ["cases/high/a.css"],
      readmeDuplicateLinks: ["cases/high/a.css"],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: false,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(false);
    expect(formatCaseRepoVerification(result)).toContain("Duplicate README case links:");
  });

  test("formats duplicate README case IDs as verification failures", () => {
    const result = {
      caseFiles: ["cases/high/a.css", "cases/high/b.css"],
      caseNoteFiles: ["cases/high/a.md", "cases/high/b.md"],
      readmeLinks: ["cases/high/a.css", "cases/high/b.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [{ id: "CASE-001", files: ["cases/high/a.css", "cases/high/b.css"] }],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: false,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(false);
    expect(formatCaseRepoVerification(result)).toContain(
      "Duplicate README case IDs:\n- CASE-001: cases/high/a.css, cases/high/b.css",
    );
  });

  test("formats README case ID filename mismatches as verification failures", () => {
    const result = {
      caseFiles: ["cases/high/selectors/wrong-name.css"],
      caseNoteFiles: ["cases/high/selectors/wrong-name.md"],
      readmeLinks: ["cases/high/selectors/wrong-name.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [
        {
          id: "LC-SEL-001",
          file: "cases/high/selectors/wrong-name.css",
          expectedBasenamePrefix: "lc-sel-001",
          actualBasename: "wrong-name",
        },
      ],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: false,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(false);
    expect(formatCaseRepoVerification(result)).toContain(
      "README case IDs do not match case file names:\n- cases/high/selectors/wrong-name.css: ID LC-SEL-001 expects basename lc-sel-001 or lc-sel-001-*; actual wrong-name",
    );
  });

  test("formats missing sidecar notes as verification failures", () => {
    const result = {
      caseFiles: ["cases/high/a.css"],
      caseNoteFiles: [],
      readmeLinks: ["cases/high/a.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: ["cases/high/a.md"],
      orphanCaseNotes: ["cases/high/orphan.md"],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: false,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(false);
    const formatted = formatCaseRepoVerification(result);
    expect(formatted).toContain("Case files missing sidecar notes:");
    expect(formatted).toContain("Sidecar notes without matching CSS cases:");
  });

  test("formats sidecar reproduction mismatches as verification failures", () => {
    const result = {
      caseFiles: ["cases/high/a.css"],
      caseNoteFiles: ["cases/high/a.md"],
      readmeLinks: ["cases/high/a.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [
        {
          file: "cases/high/a.css",
          noteFile: "cases/high/a.md",
          reason: "css fenced block does not match case source",
        },
      ],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: false,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(false);
    expect(formatCaseRepoVerification(result)).toContain(
      "Sidecar note CSS reproduction blocks do not match case files:",
    );
  });

  test("formats sidecar heading mismatches as verification failures", () => {
    const result = {
      caseFiles: ["cases/high/a.css"],
      caseNoteFiles: ["cases/high/a.md"],
      readmeLinks: ["cases/high/a.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [
        {
          noteFile: "cases/high/a.md",
          missingHeadings: ["Parser Results", "Spec Context or Triage Note"],
        },
      ],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: false,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(false);
    expect(formatCaseRepoVerification(result)).toContain(
      "Sidecar notes missing required headings:\n- cases/high/a.md: Parser Results, Spec Context or Triage Note",
    );
  });

  test("formats sidecar context mismatches as verification failures", () => {
    const result = {
      caseFiles: ["cases/high/a.css"],
      caseNoteFiles: ["cases/high/a.md"],
      readmeLinks: ["cases/high/a.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [
        {
          noteFile: "cases/high/a.md",
          reason: "missing non-empty Spec Context or Triage Note body",
        },
      ],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: false,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(false);
    expect(formatCaseRepoVerification(result)).toContain(
      "Sidecar notes missing explanatory context text:\n- cases/high/a.md: missing non-empty Spec Context or Triage Note body",
    );
  });

  test("formats sidecar title ID mismatches as verification failures", () => {
    const result = {
      caseFiles: ["cases/high/a.css"],
      caseNoteFiles: ["cases/high/a.md"],
      readmeLinks: ["cases/high/a.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [
        {
          file: "cases/high/a.css",
          noteFile: "cases/high/a.md",
          expectedId: "CASE-001",
          actualId: "OTHER-001",
          reason: "sidecar title ID does not match README case ID",
        },
      ],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: false,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(false);
    expect(formatCaseRepoVerification(result)).toContain(
      "Sidecar note title IDs do not match README case IDs:\n- cases/high/a.md for cases/high/a.css: sidecar title ID does not match README case ID; expected CASE-001; actual OTHER-001",
    );
  });

  test("formats sidecar parser result tables with missing parser expectations", () => {
    const result = {
      caseFiles: ["cases/high/a.css"],
      caseNoteFiles: ["cases/high/a.md"],
      readmeLinks: ["cases/high/a.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [
        {
          file: "cases/high/a.css",
          noteFile: "cases/high/a.md",
          parser: "oxc-css-parser" as const,
        },
      ],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: false,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(false);
    expect(formatCaseRepoVerification(result)).toContain(
      "Sidecar parser result tables missing parser expectations:\n- cases/high/a.md for cases/high/a.css: oxc-css-parser",
    );
  });

  test("formats sidecar parser result tables with missing error-message snippets", () => {
    const result = {
      caseFiles: ["cases/high/a.css"],
      caseNoteFiles: ["cases/high/a.md"],
      readmeLinks: ["cases/high/a.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [
        {
          file: "cases/high/a.css",
          noteFile: "cases/high/a.md",
          parser: "lightningcss" as const,
          status: "rejected" as const,
        },
      ],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: false,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(false);
    expect(formatCaseRepoVerification(result)).toContain(
      "Sidecar parser result tables missing error-message snippets:\n- cases/high/a.md for cases/high/a.css: lightningcss rejected",
    );
  });

  test("formats sidecar parser result table mismatches", () => {
    const result = {
      caseFiles: ["cases/high/a.css"],
      caseNoteFiles: ["cases/high/a.md"],
      readmeLinks: ["cases/high/a.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [
        {
          file: "cases/high/a.css",
          noteFile: "cases/high/a.md",
          parser: "lightningcss" as const,
          expected: "rejected: bad",
          actual: "accepted",
        },
      ],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: false,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(false);
    expect(formatCaseRepoVerification(result)).toContain(
      "Sidecar parser result table mismatches:\n- cases/high/a.md for cases/high/a.css lightningcss: expected rejected: bad; actual accepted",
    );
  });

  test("formats README links outside priority sections as verification failures", () => {
    const result = {
      caseFiles: ["cases/high/a.css"],
      caseNoteFiles: ["cases/high/a.md"],
      readmeLinks: ["cases/high/a.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: ["cases/high/a.css"],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: false,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(false);
    expect(formatCaseRepoVerification(result)).toContain(
      "README case links outside High/Medium/Low priority sections:",
    );
  });

  test("formats priority path mismatches as verification failures", () => {
    const result = {
      caseFiles: ["cases/medium/a.css"],
      caseNoteFiles: ["cases/medium/a.md"],
      readmeLinks: ["cases/medium/a.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [
        {
          file: "cases/medium/a.css",
          priority: "High Priority" as const,
          expectedPrefix: "cases/high/",
        },
      ],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: false,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(false);
    expect(formatCaseRepoVerification(result)).toContain(
      "README priority sections do not match case file paths:",
    );
  });

  test("formats README links without parser matrix rows as verification failures", () => {
    const result = {
      caseFiles: ["cases/high/a.css"],
      caseNoteFiles: ["cases/high/a.md"],
      readmeLinks: ["cases/high/a.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: ["cases/high/a.css"],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: false,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(false);
    expect(formatCaseRepoVerification(result)).toContain(
      "README case links without parser matrix rows:",
    );
  });

  test("formats matrix rows missing parser expectations as verification failures", () => {
    const result = {
      caseFiles: ["cases/high/a.css"],
      caseNoteFiles: ["cases/high/a.md"],
      readmeLinks: ["cases/high/a.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [
        { file: "cases/high/a.css", parser: "oxc-css-parser" as const },
      ],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: false,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(false);
    expect(formatCaseRepoVerification(result)).toContain(
      "README parser matrix rows missing parser expectations:",
    );
  });

  test("formats README parser matrix rows with missing error-message snippets", () => {
    const result = {
      caseFiles: ["cases/high/a.css"],
      caseNoteFiles: ["cases/high/a.md"],
      readmeLinks: ["cases/high/a.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [
        {
          file: "cases/high/a.css",
          parser: "oxc-css-parser" as const,
          status: "rejected" as const,
        },
      ],
      matrixMismatches: [],
      minimizationChecked: false,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(false);
    expect(formatCaseRepoVerification(result)).toContain(
      "README parser matrix rows missing error-message snippets:\n- cases/high/a.css: oxc-css-parser rejected",
    );
  });

  test("formats reducible cases with reduced source candidates", () => {
    const result = {
      caseFiles: ["cases/high/a.css"],
      caseNoteFiles: ["cases/high/a.md"],
      readmeLinks: ["cases/high/a.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: true,
      reducibleCases: [
        {
          file: "cases/high/a.css",
          originalBytes: 30,
          reducedBytes: 10,
          attempts: 12,
          reducedSource: "a{b:c}",
        },
      ],
    };

    expect(caseRepoVerificationPassed(result)).toBe(false);
    expect(formatCaseRepoVerification(result)).toContain(
      '- cases/high/a.css: 30 -> 10 bytes in 12 attempts\n  candidate: "a{b:c}"',
    );
  });

  test("formats a passing verification summary with minimization checked", () => {
    const result = {
      caseFiles: ["cases/high/a.css"],
      caseNoteFiles: ["cases/high/a.md"],
      readmeLinks: ["cases/high/a.css"],
      readmeDuplicateLinks: [],
      readmeDuplicateCaseIds: [],
      readmeCaseIdPathMismatches: [],
      missingFromReadme: [],
      missingOnDisk: [],
      missingCaseNotes: [],
      orphanCaseNotes: [],
      sidecarSourceMismatches: [],
      sidecarHeadingMismatches: [],
      sidecarContextMismatches: [],
      sidecarTitleIdMismatches: [],
      sidecarRowsMissingParserExpectations: [],
      sidecarRowsMissingParserMessages: [],
      sidecarMatrixMismatches: [],
      uninterestingCases: [],
      readmeLinksWithoutPriority: [],
      readmePriorityPathMismatches: [],
      readmeLinksWithoutMatrix: [],
      readmeRowsMissingParserExpectations: [],
      readmeRowsMissingParserMessages: [],
      matrixMismatches: [],
      minimizationChecked: true,
      reducibleCases: [],
    };

    expect(caseRepoVerificationPassed(result)).toBe(true);
    expect(formatCaseRepoVerification(result)).toBe(
      "Checked 1 CSS case files, 1 sidecar notes, and 1 README case links.\nAll case files have sidecar notes with matching CSS reproduction blocks, required headings with explanatory text, README-matching title IDs, and complete parser result tables with error-message snippets, are covered by unique README links and IDs, use case filenames matching their README IDs, are listed under matching priority sections, have complete README parser matrix rows with error-message snippets, still replay as interesting, match the README and sidecar parser matrices, and are reduction-stable under the configured minimizer.\n",
    );
  });
});
