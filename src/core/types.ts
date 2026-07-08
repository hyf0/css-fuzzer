export const parserNames = ["postcss", "prettier-css", "lightningcss", "oxc-css-parser"] as const;

export type ParserName = (typeof parserNames)[number];

export type CssSyntax = "css";

export const parserStatuses = [
  "accepted",
  "accepted_with_errors",
  "rejected",
  "crashed",
  "timed_out",
  "unsupported",
] as const;

export type ParserStatus = (typeof parserStatuses)[number];

export interface ParseContext {
  readonly syntax: CssSyntax;
  readonly timeoutMs: number;
}

export interface ParseResult {
  readonly parser: ParserName;
  readonly status: ParserStatus;
  readonly durationMs: number;
  readonly message?: string;
  readonly detail?: unknown;
}

export interface ParserAdapter {
  readonly name: ParserName;
  parse(source: string, context: ParseContext): Promise<ParseResult>;
}

export interface FuzzCase {
  readonly id: string;
  readonly seed: string;
  readonly syntax: CssSyntax;
  readonly source: string;
  readonly tags: readonly string[];
  readonly specRefs: readonly string[];
}

export interface DifferentialFinding {
  readonly testCase: FuzzCase;
  readonly results: readonly ParseResult[];
  readonly interesting: boolean;
  readonly reason: string;
}

export interface RunOptions {
  readonly seed: bigint;
  readonly iterations: number;
  readonly syntax: CssSyntax;
  readonly timeoutMs: number;
  readonly minimize: boolean;
  readonly minimizeAttempts: number;
  readonly byteMinimize: boolean;
}

export interface MinimizedFinding {
  readonly original: DifferentialFinding;
  readonly minimizedSource: string;
  readonly minimizedResults: readonly ParseResult[];
  readonly attempts: number;
}

export function isSupported(result: ParseResult): boolean {
  return result.status !== "unsupported";
}

export function isParserStatus(value: unknown): value is ParserStatus {
  return typeof value === "string" && (parserStatuses as readonly string[]).includes(value);
}

export function isHardFailure(result: ParseResult): boolean {
  return result.status === "crashed" || result.status === "timed_out";
}

export function parserStatusLabel(result: ParseResult): string {
  return `${result.parser}:${result.status}`;
}
