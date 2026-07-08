import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";

const execFileAsync = promisify(execFile);

describe("CLI integration", () => {
  test("fails loudly when a configured spec corpus is missing", async () => {
    const missingCorpus = path.join(os.tmpdir(), `missing-css-corpus-${process.pid}.json`);

    await expect(
      runCli(["generate", "--count", "1", "--spec-corpus", missingCorpus]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Spec corpus not found"),
    });
  });

  test("allows corpus-free generation when explicitly requested", async () => {
    await expect(
      runCli(["generate", "--count", "1", "--seed", "1", "--no-spec-corpus"]),
    ).resolves.toMatchObject({
      stdout: expect.stringContaining("/* css-"),
    });
  });

  test("rejects value-less flags with values", async () => {
    await expect(
      runCli(["generate", "--count", "1", "--seed", "1", "--no-spec-corpus", "false"]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("--no-spec-corpus does not take a value"),
    });
  });

  test("rejects non-CSS syntax modes instead of running mismatched adapters", async () => {
    await expect(
      runCli(["generate", "--count", "1", "--seed", "1", "--syntax", "scss", "--no-spec-corpus"]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Unsupported syntax "scss"'),
    });
  });

  test("rejects misspelled command options before running a campaign", async () => {
    await expect(runCli(["fuzz", "--itterations", "10", "--no-spec-corpus"])).rejects.toMatchObject(
      {
        stderr: expect.stringContaining("Unknown option for fuzz: --itterations"),
      },
    );
  });

  test("rejects legacy spec corpora without a download manifest", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-cli-"));
    const corpus = path.join(dir, "examples.json");
    try {
      await writeFile(
        corpus,
        JSON.stringify({
          fetchedAt: "2026-07-08T00:00:00.000Z",
          examples: [{ slug: "css-color-4", source: "a { color: red; }" }],
        }),
        "utf8",
      );

      await expect(
        runCli(["generate", "--count", "1", "--spec-corpus", corpus]),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("complete download manifest"),
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("can require all selected spec refs in the generator coverage window", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-cli-"));
    const corpus = path.join(dir, "examples.json");
    try {
      await writeFile(
        corpus,
        JSON.stringify({
          fetchedAt: new Date().toISOString(),
          selectedSlugs: ["css-color-5"],
          downloadedSlugs: ["css-color-5"],
          failedSpecs: [],
          exampleCountsBySpec: [{ slug: "css-color-5", extractedExamples: 1 }],
          examples: [
            {
              slug: "css-color-5",
              source: ".from-corpus { color: oklch(70% 0.1 230); }",
            },
          ],
        }),
        "utf8",
      );

      await expect(
        runCli([
          "verify-generator-coverage",
          "--spec-corpus",
          corpus,
          "--require-selected-specs",
          "--count",
          "1000",
        ]),
      ).resolves.toMatchObject({
        stdout: expect.stringContaining("Required spec refs: 1/1"),
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function runCli(
  args: readonly string[],
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const tsxBin = path.join(process.cwd(), "node_modules/.bin/tsx");
  const cliPath = path.join(process.cwd(), "src/cli.ts");
  return await execFileAsync(tsxBin, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}
