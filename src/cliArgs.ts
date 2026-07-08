import type { CssSyntax } from "./core/types.js";

export interface ParsedArgs {
  readonly [key: string]: string | boolean | undefined;
}

export function parseArgs(args: readonly string[]): ParsedArgs {
  const result: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--") {
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument "${arg}"`);
    }
    const name = arg.slice(2);
    if (Object.hasOwn(result, name)) {
      throw new Error(`Duplicate option "--${name}"`);
    }
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) {
      result[name] = true;
      continue;
    }
    result[name] = next;
    index += 1;
  }
  return result;
}

export function assertKnownArgs(
  args: ParsedArgs,
  allowedNames: ReadonlySet<string>,
  command: string,
): void {
  const unknown = Object.keys(args)
    .filter((name) => !allowedNames.has(name))
    .sort((a, b) => a.localeCompare(b));
  if (unknown.length === 0) {
    return;
  }
  const formatted = unknown.map((name) => `--${name}`).join(", ");
  throw new Error(`Unknown option${unknown.length === 1 ? "" : "s"} for ${command}: ${formatted}`);
}

export function parseSyntax(value: string): CssSyntax {
  if (value === "css") {
    return value;
  }
  throw new Error(`Unsupported syntax "${value}"`);
}

export function parsePositiveIntegerArg(args: ParsedArgs, name: string, fallback: number): number {
  return parseOptionalPositiveIntegerArg(args, name) ?? fallback;
}

export function parseOptionalPositiveIntegerArg(
  args: ParsedArgs,
  name: string,
): number | undefined {
  const value = args[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`--${name} requires a value`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

export function parseBigIntArg(args: ParsedArgs, name: string, fallback: bigint): bigint {
  const value = args[name];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new Error(`--${name} requires a value`);
  }
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`--${name} must be an integer`);
  }
  return BigInt(value);
}

export function parseBooleanFlagArg(args: ParsedArgs, name: string): boolean {
  const value = args[name];
  if (value === undefined) {
    return false;
  }
  if (value === true) {
    return true;
  }
  throw new Error(`--${name} does not take a value`);
}

export function stringArg(args: ParsedArgs, name: string, fallback: string): string {
  return optionalStringArg(args, name) ?? fallback;
}

export function optionalStringArg(args: ParsedArgs, name: string): string | undefined {
  const value = args[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`--${name} requires a value`);
  }
  return value;
}

export function requiredStringArg(args: ParsedArgs, primary: string, fallbackName: string): string {
  const primaryValue = args[primary];
  if (typeof primaryValue === "string") {
    return primaryValue;
  }
  if (primaryValue === true) {
    throw new Error(`--${primary} requires a value`);
  }
  const fallbackValue = args[fallbackName];
  if (typeof fallbackValue === "string") {
    return fallbackValue;
  }
  if (fallbackValue === true) {
    throw new Error(`--${fallbackName} requires a value`);
  }
  throw new Error(`Expected --${primary} or --${fallbackName}`);
}
