import { afterEach, describe, expect, test } from "vite-plus/test";
import { createDefaultAdapters } from "../src/parsers/index.js";
import { closeJsParserWorkers, runJsParserWorker } from "../src/parsers/jsWorker.js";
import { runDifferentialCase } from "../src/runner/differential.js";

afterEach(() => {
  closeJsParserWorkers();
});

describe("default parser adapters", () => {
  test("all adapters accept a basic stylesheet", async () => {
    const finding = await runDifferentialCase(
      createDefaultAdapters(),
      {
        id: "basic",
        seed: "integration",
        syntax: "css",
        source: "a { color: red; }\n",
        tags: ["integration"],
        specRefs: [],
      },
      { syntax: "css", timeoutMs: 2_000 },
    );

    expect(finding.results.map((result) => [result.parser, result.status])).toEqual([
      ["postcss", "accepted"],
      ["prettier-css", "accepted"],
      ["lightningcss", "accepted"],
      ["oxc-css-parser", "accepted"],
    ]);
    expect(finding.interesting).toBe(false);
  });

  test("replays a known OXC-only container query disagreement", async () => {
    const finding = await runDifferentialCase(
      createDefaultAdapters(),
      {
        id: "oxc-container-001",
        seed: "integration",
        syntax: "css",
        source: "@container my-page-layout { .card { padding: 1em; } }\n",
        tags: ["integration"],
        specRefs: ["css-conditional-5"],
      },
      { syntax: "css", timeoutMs: 2_000 },
    );

    expect(finding.results.map((result) => [result.parser, result.status])).toEqual([
      ["postcss", "accepted"],
      ["prettier-css", "accepted"],
      ["lightningcss", "accepted"],
      ["oxc-css-parser", "rejected"],
    ]);
    expect(finding.interesting).toBe(true);
  });

  test("reports OXC recoverable error messages", async () => {
    const finding = await runDifferentialCase(
      createDefaultAdapters(),
      {
        id: "oxc-color-profile-001",
        seed: "integration",
        syntax: "css",
        source: '@color-profile device-cmyk { src: url("profile.icc"); }\n',
        tags: ["integration"],
        specRefs: ["css-color-5"],
      },
      { syntax: "css", timeoutMs: 2_000 },
    );

    expect(finding.results.find((result) => result.parser === "oxc-css-parser")).toMatchObject({
      parser: "oxc-css-parser",
      status: "accepted_with_errors",
      message: "dashed identifier is expected",
    });
    expect(finding.interesting).toBe(true);
  });

  test("distinguishes Prettier syntax rejection from internal crashes", async () => {
    await expect(
      runJsParserWorker("prettier-css", "a { color:", { syntax: "css", timeoutMs: 2_000 }),
    ).resolves.toMatchObject({ parser: "prettier-css", status: "rejected" });

    await expect(
      runJsParserWorker("prettier-css", "@custom-selector :--heading { }", {
        syntax: "css",
        timeoutMs: 2_000,
      }),
    ).resolves.toMatchObject({ parser: "prettier-css", status: "crashed" });
  });
});
