import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { ParserName } from "../core/types.js";
import { loadSpecCorpus, readSpecCorpusAudit } from "../generator/specCorpus.js";

const require = createRequire(import.meta.url);

export interface ParserEnvironment {
  readonly parser: ParserName;
  readonly packageName?: string;
  readonly version?: string;
  readonly gitHead?: string;
}

export interface SpecCorpusEnvironment {
  readonly path: string;
  readonly fetchedAt?: string;
  readonly extractedExamples?: number;
  readonly normalizedExamples?: number;
  readonly specSlugs?: number;
  readonly selectedSpecs?: number;
  readonly downloadedSpecs?: number;
  readonly failedSpecs?: number;
}

export interface FuzzerEnvironment {
  readonly node: string;
  readonly packageManager?: string;
  readonly cssFuzzerGitHead?: string;
  readonly parsers: readonly ParserEnvironment[];
  readonly specCorpus?: SpecCorpusEnvironment;
}

export function collectEnvironment(
  options: {
    readonly specCorpusPath?: string;
  } = {},
): FuzzerEnvironment {
  return {
    node: process.version,
    ...optional("packageManager", readRootPackageManager()),
    ...optional("cssFuzzerGitHead", gitHead(process.cwd())),
    parsers: [
      {
        parser: "postcss",
        packageName: "postcss",
        ...optional("version", packageVersion("postcss")),
      },
      {
        parser: "prettier-css",
        packageName: "prettier",
        ...optional("version", packageVersion("prettier")),
      },
      {
        parser: "lightningcss",
        packageName: "lightningcss",
        ...optional("version", packageVersion("lightningcss")),
      },
      {
        parser: "oxc-css-parser",
        packageName: "oxc-css-parser",
        ...optional("gitHead", gitHead(path.join(process.cwd(), "../oxc-css-parser"))),
      },
    ],
    ...optional(
      "specCorpus",
      options.specCorpusPath === undefined
        ? undefined
        : specCorpusEnvironment(options.specCorpusPath),
    ),
  };
}

function specCorpusEnvironment(corpusPath: string): SpecCorpusEnvironment | undefined {
  if (!existsSync(corpusPath)) {
    return undefined;
  }
  const text = readFileSync(corpusPath, "utf8");
  const parsed = JSON.parse(text) as {
    readonly fetchedAt?: unknown;
    readonly examples?: readonly { readonly slug?: unknown }[];
  };
  const audit = readSpecCorpusAudit(corpusPath);
  const normalized = loadSpecCorpus({ path: corpusPath });
  return {
    path: corpusPath,
    ...(typeof parsed.fetchedAt === "string" ? { fetchedAt: parsed.fetchedAt } : {}),
    ...(parsed.examples === undefined ? {} : { extractedExamples: parsed.examples.length }),
    normalizedExamples: normalized.length,
    specSlugs: new Set(normalized.flatMap((seed) => seed.specRefs)).size,
    selectedSpecs: audit.selectedSlugs.length,
    downloadedSpecs: audit.downloadedSlugs.length,
    failedSpecs: audit.failedSpecs.length,
  };
}

function readRootPackageManager(): string | undefined {
  try {
    const text = readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    const parsed = JSON.parse(text) as { readonly packageManager?: unknown };
    return typeof parsed.packageManager === "string" ? parsed.packageManager : undefined;
  } catch {
    return undefined;
  }
}

function packageVersion(packageName: string): string | undefined {
  try {
    let current = path.dirname(require.resolve(packageName));
    while (true) {
      const packageJsonPath = path.join(current, "package.json");
      if (existsSync(packageJsonPath)) {
        const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
          readonly name?: unknown;
          readonly version?: unknown;
        };
        if (parsed.name === packageName && typeof parsed.version === "string") {
          return parsed.version;
        }
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return undefined;
      }
      current = parent;
    }
  } catch {
    return undefined;
  }
}

function gitHead(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function optional<const Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): Value extends undefined ? Record<string, never> : { readonly [K in Key]: Value } {
  return (value === undefined ? {} : { [key]: value }) as Value extends undefined
    ? Record<string, never>
    : { readonly [K in Key]: Value };
}
