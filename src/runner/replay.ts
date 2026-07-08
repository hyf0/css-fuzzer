import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { CssSyntax, ParserAdapter, ParseResult } from "../core/types.js";
import { findingFingerprint } from "./differential.js";
import { runDifferentialCase } from "./differential.js";

export interface ReplayRow {
  readonly file: string;
  readonly source: string;
  readonly results: readonly ParseResult[];
}

export async function collectCssFiles(root: string): Promise<readonly string[]> {
  const info = await stat(root);
  if (info.isFile()) {
    return root.endsWith(".css") ? [root] : [];
  }

  const files: string[] = [];
  await collectCssFilesInto(root, files);
  return files.sort((a, b) => a.localeCompare(b));
}

export async function replayCssFiles(
  files: readonly string[],
  adapters: readonly ParserAdapter[],
  options: { readonly syntax: CssSyntax; readonly timeoutMs: number },
): Promise<readonly ReplayRow[]> {
  const rows: ReplayRow[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const finding = await runDifferentialCase(
      adapters,
      {
        id: path.basename(file, ".css"),
        seed: file,
        syntax: options.syntax,
        source,
        tags: ["replay"],
        specRefs: [],
      },
      options,
    );
    rows.push({ file, source, results: finding.results });
  }
  return rows;
}

export function formatReplayMarkdown(rows: readonly ReplayRow[], baseDir: string): string {
  const lines = [
    "| File | postcss | prettier CSS parser | lightningcss | oxc-css-parser | Fingerprint |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const row of rows) {
    const resultByParser = new Map(row.results.map((result) => [result.parser, result]));
    const relativeFile = path.relative(baseDir, row.file) || row.file;
    lines.push(
      [
        `\`${relativeFile}\``,
        formatCell(resultByParser.get("postcss")),
        formatCell(resultByParser.get("prettier-css")),
        formatCell(resultByParser.get("lightningcss")),
        formatCell(resultByParser.get("oxc-css-parser")),
        markdownCodeSpan(findingFingerprint(row.results)),
      ].join(" | "),
    );
  }

  return `${lines.join("\n")}\n`;
}

export function formatCell(result: ParseResult | undefined): string {
  if (result === undefined) {
    return "missing";
  }
  if (result.message === undefined) {
    return result.status;
  }
  return `${result.status}: ${markdownCodeSpan(firstLine(result.message))}`;
}

async function collectCssFilesInto(dir: string, files: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectCssFilesInto(fullPath, files);
    } else if (entry.isFile() && fullPath.endsWith(".css")) {
      files.push(fullPath);
    }
  }
}

function firstLine(value: string): string {
  return value.split("\n")[0] ?? value;
}

function markdownCodeSpan(value: string): string {
  const runs = value.match(/`+/g) ?? [];
  const fenceLength = Math.max(1, ...runs.map((run) => run.length + 1));
  const fence = "`".repeat(fenceLength);
  return runs.length === 0 ? `${fence}${value}${fence}` : `${fence} ${value} ${fence}`;
}
