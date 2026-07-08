import type { ParserName, ParseResult, ParserStatus } from "../core/types.js";

export async function timed<T>(
  operation: () => Promise<T> | T,
): Promise<{ value: T; durationMs: number }> {
  const started = performance.now();
  const value = await operation();
  return { value, durationMs: performance.now() - started };
}

export function result(
  parser: ParserName,
  status: ParserStatus,
  durationMs: number,
  message?: string,
  detail?: unknown,
): ParseResult {
  const base = { parser, status, durationMs };
  return {
    ...base,
    ...(message === undefined ? {} : { message }),
    ...(detail === undefined ? {} : { detail }),
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
