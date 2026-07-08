import { describe, expect, test } from "vite-plus/test";
import { formatReplayMarkdown } from "../src/runner/replay.js";

describe("formatReplayMarkdown", () => {
  test("formats parser results into a stable matrix", () => {
    expect(
      formatReplayMarkdown(
        [
          {
            file: "/repo/cases/a.css",
            source: "a { color: red; }",
            results: [
              { parser: "postcss", status: "accepted", durationMs: 1 },
              { parser: "prettier-css", status: "accepted", durationMs: 1 },
              {
                parser: "lightningcss",
                status: "rejected",
                durationMs: 1,
                message: "bad\nmore",
              },
              { parser: "oxc-css-parser", status: "accepted", durationMs: 1 },
            ],
          },
        ],
        "/repo",
      ),
    ).toContain("rejected: `bad`");
  });

  test("wraps parser messages and fingerprints so markdown table pipes stay in cells", () => {
    const markdown = formatReplayMarkdown(
      [
        {
          file: "/repo/cases/column.css",
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
            {
              parser: "oxc-css-parser",
              status: "rejected",
              durationMs: 1,
              message: "expect token `<ident>`, but found `{`",
            },
          ],
        },
      ],
      "/repo",
    );

    expect(markdown).toContain("rejected: `Unexpected token in namespace selector: Delim('|')`");
    expect(markdown).toContain("rejected: `` expect token `<ident>`, but found `{` ``");
    expect(markdown).toContain(
      "`` lightningcss:rejected:Unexpected token in namespace selector: Delim('|')|oxc-css-parser:rejected:expect token `<ident>`, but found `{`|postcss:accepted|prettier-css:accepted ``",
    );
  });
});
