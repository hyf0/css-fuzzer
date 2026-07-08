import { spawn } from "node:child_process";
import path from "node:path";
import {
  assertKnownArgs,
  parseArgs,
  parseBooleanFlagArg,
  parsePositiveIntegerArg,
  stringArg,
} from "../src/cliArgs.js";

interface ReportReadyOptions {
  readonly casesDir: string;
  readonly casesReadme: string;
  readonly seed: string;
  readonly iterations: number;
  readonly roundtripCount: number;
  readonly timeoutMs: number;
  readonly minimizeAttempts: number;
  readonly outRoot: string;
  readonly skipFetchSpecs: boolean;
}

const optionNames = new Set([
  "cases-dir",
  "cases-readme",
  "seed",
  "iterations",
  "roundtrip-count",
  "timeout-ms",
  "minimize-attempts",
  "out-root",
  "skip-fetch-specs",
]);

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }
  const options = parseOptions(process.argv.slice(2));
  const campaignOut = path.join(options.outRoot, "campaign");
  const lightningOut = path.join(options.outRoot, "lightning-roundtrip");
  const prettierOut = path.join(options.outRoot, "prettier-roundtrip");

  await run("vp", ["check"]);
  await run("vp", ["test"]);
  await run("vp", ["build"]);
  await run("vp", ["run", "build:oxc-driver"]);
  if (!options.skipFetchSpecs) {
    await run("vp", ["run", "fetch-specs", "--", "--download"]);
  }
  await run("vp", ["run", "verify-spec-corpus"]);
  await run("vp", ["run", "verify-generator-coverage", "--", "--require-selected-specs"]);
  await run("vp", [
    "run",
    "verify-cases",
    "--",
    "--dir",
    options.casesDir,
    "--readme",
    options.casesReadme,
    "--timeout-ms",
    String(options.timeoutMs),
    "--check-minimized",
    "--minimize-attempts",
    String(options.minimizeAttempts),
  ]);
  await run("vp", [
    "run",
    "fuzz",
    "--",
    "--seed",
    options.seed,
    "--iterations",
    String(options.iterations),
    "--known-dir",
    options.casesDir,
    "--out",
    campaignOut,
    "--minimize",
    "--timeout-ms",
    String(options.timeoutMs),
  ]);
  await verifyFindingsKnown(campaignOut, options);
  await run("vp", [
    "run",
    "verify-lightning-roundtrip",
    "--",
    "--seed",
    options.seed,
    "--count",
    String(options.roundtripCount),
    "--known-dir",
    options.casesDir,
    "--out",
    lightningOut,
    "--minimize",
    "--timeout-ms",
    String(options.timeoutMs),
  ]);
  await verifyFindingsKnown(lightningOut, options);
  await run("vp", [
    "run",
    "verify-prettier-roundtrip",
    "--",
    "--seed",
    options.seed,
    "--count",
    String(options.roundtripCount),
    "--known-dir",
    options.casesDir,
    "--out",
    prettierOut,
    "--minimize",
    "--timeout-ms",
    String(options.timeoutMs),
  ]);
  await verifyFindingsKnown(prettierOut, options);
}

function parseOptions(rawArgs: readonly string[]): ReportReadyOptions {
  const args = parseArgs(rawArgs);
  assertKnownArgs(args, optionNames, "verify-report-ready");
  return {
    casesDir: stringArg(args, "cases-dir", "../css-parser-fuzzer-cases/cases"),
    casesReadme: stringArg(args, "cases-readme", "../css-parser-fuzzer-cases/README.md"),
    seed: stringArg(args, "seed", "238000"),
    iterations: parsePositiveIntegerArg(args, "iterations", 5_000),
    roundtripCount: parsePositiveIntegerArg(args, "roundtrip-count", 1_000),
    timeoutMs: parsePositiveIntegerArg(args, "timeout-ms", 1_500),
    minimizeAttempts: parsePositiveIntegerArg(args, "minimize-attempts", 80),
    outRoot: stringArg(args, "out-root", path.join("findings", `report-ready-${runId()}`)),
    skipFetchSpecs: parseBooleanFlagArg(args, "skip-fetch-specs"),
  };
}

async function verifyFindingsKnown(
  findingsDir: string,
  options: ReportReadyOptions,
): Promise<void> {
  await run("vp", [
    "run",
    "verify-findings-known",
    "--",
    "--findings-dir",
    findingsDir,
    "--known-dir",
    options.casesDir,
    "--timeout-ms",
    String(options.timeoutMs),
  ]);
}

async function run(command: string, args: readonly string[]): Promise<void> {
  console.error(`\n$ ${[command, ...args].join(" ")}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const reason = signal === null ? `exit code ${code ?? "unknown"}` : `signal ${signal}`;
      reject(new Error(`${command} ${args.join(" ")} failed with ${reason}`));
    });
  });
}

function runId(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function printHelp(): void {
  console.log(`Usage: vp run verify-report-ready -- [options]

Runs the report-ready gate set for the fuzzer and companion cases repository.

Options:
  --cases-dir <path>        Case CSS directory. Default: ../css-parser-fuzzer-cases/cases
  --cases-readme <path>     Case repository README. Default: ../css-parser-fuzzer-cases/README.md
  --seed <integer>          Seed for fuzz and roundtrip gates. Default: 238000
  --iterations <integer>    Fuzz campaign iteration count. Default: 5000
  --roundtrip-count <int>   Lightning/Prettier roundtrip generation count. Default: 1000
  --timeout-ms <integer>    Per-parser timeout in milliseconds. Default: 1500
  --minimize-attempts <n>   Case verifier minimizer attempt budget. Default: 80
  --out-root <path>         Fresh findings output root. Default: findings/report-ready-<timestamp>
  --skip-fetch-specs        Reuse the current spec corpus instead of running fetch-specs -- --download
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
