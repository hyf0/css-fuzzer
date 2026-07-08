import { describe, expect, test } from "vite-plus/test";
import { collectEnvironment } from "../src/runner/environment.js";

describe("collectEnvironment", () => {
  test("records installed parser package versions", () => {
    const environment = collectEnvironment();
    const parserVersions = new Map(
      environment.parsers.map((parser) => [parser.parser, parser.version ?? parser.gitHead]),
    );

    expect(parserVersions.get("postcss")).toMatch(/^\d+\./);
    expect(parserVersions.get("prettier-css")).toMatch(/^\d+\./);
    expect(parserVersions.get("lightningcss")).toMatch(/^\d+\./);
    expect(parserVersions.has("oxc-css-parser")).toBe(true);
  });
});
