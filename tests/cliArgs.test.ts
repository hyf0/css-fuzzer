import { describe, expect, test } from "vite-plus/test";
import {
  assertKnownArgs,
  parseArgs,
  parseBigIntArg,
  parseBooleanFlagArg,
  parseOptionalPositiveIntegerArg,
  parsePositiveIntegerArg,
  parseSyntax,
  optionalStringArg,
  requiredStringArg,
  stringArg,
} from "../src/cliArgs.js";

describe("CLI argument parsing", () => {
  test("parses flags and values", () => {
    expect(parseArgs(["--seed", "42", "--minimize", "--out", "findings/run"])).toEqual({
      seed: "42",
      minimize: true,
      out: "findings/run",
    });
  });

  test("parses value-less boolean flags", () => {
    expect(parseBooleanFlagArg(parseArgs(["--minimize"]), "minimize")).toBe(true);
    expect(parseBooleanFlagArg(parseArgs([]), "minimize")).toBe(false);
    expect(() => parseBooleanFlagArg(parseArgs(["--minimize", "false"]), "minimize")).toThrow(
      "--minimize does not take a value",
    );
  });

  test("ignores command separator tokens passed through package scripts", () => {
    expect(parseArgs(["--", "--seed", "42"])).toEqual({ seed: "42" });
  });

  test("rejects positional arguments", () => {
    expect(() => parseArgs(["input.css"])).toThrow('Unexpected positional argument "input.css"');
  });

  test("rejects duplicate options", () => {
    expect(() => parseArgs(["--seed", "1", "--seed", "2"])).toThrow('Duplicate option "--seed"');
  });

  test("rejects unknown command options", () => {
    const args = parseArgs(["--count", "2", "--itterations", "10"]);
    expect(() => assertKnownArgs(args, new Set(["count"]), "generate")).toThrow(
      "Unknown option for generate: --itterations",
    );
  });

  test("only accepts CSS syntax", () => {
    expect(parseSyntax("css")).toBe("css");
    expect(() => parseSyntax("scss")).toThrow('Unsupported syntax "scss"');
    expect(() => parseSyntax("less")).toThrow('Unsupported syntax "less"');
  });

  test("requires values for string options", () => {
    const args = parseArgs(["--out"]);
    expect(() => stringArg(args, "out", "findings/cases")).toThrow("--out requires a value");
    expect(() => optionalStringArg(args, "out")).toThrow("--out requires a value");
  });

  test("selects a required fallback string option", () => {
    expect(requiredStringArg(parseArgs(["--dir", "cases"]), "file", "dir")).toBe("cases");
  });

  test("rejects missing required string option values", () => {
    expect(() => requiredStringArg(parseArgs(["--dir"]), "file", "dir")).toThrow(
      "--dir requires a value",
    );
  });

  test("parses positive integer options", () => {
    expect(parsePositiveIntegerArg(parseArgs(["--iterations", "500"]), "iterations", 100)).toBe(
      500,
    );
    expect(
      parseOptionalPositiveIntegerArg(
        parseArgs(["--max-spec-examples", "12"]),
        "max-spec-examples",
      ),
    ).toBe(12);
  });

  test("rejects non-positive and fractional integer options", () => {
    expect(() =>
      parsePositiveIntegerArg(parseArgs(["--timeout-ms", "0"]), "timeout-ms", 1),
    ).toThrow("--timeout-ms must be a positive integer");
    expect(() =>
      parsePositiveIntegerArg(parseArgs(["--iterations", "1.5"]), "iterations", 1),
    ).toThrow("--iterations must be a positive integer");
    expect(() =>
      parseOptionalPositiveIntegerArg(parseArgs(["--max-spec-examples"]), "max-spec-examples"),
    ).toThrow("--max-spec-examples requires a value");
  });

  test("parses integer seeds", () => {
    expect(parseBigIntArg(parseArgs(["--seed", "-12"]), "seed", 1n)).toBe(-12n);
  });

  test("rejects fractional seeds", () => {
    expect(() => parseBigIntArg(parseArgs(["--seed", "1.5"]), "seed", 1n)).toThrow(
      "--seed must be an integer",
    );
  });
});
