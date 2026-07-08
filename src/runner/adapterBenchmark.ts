import type { ParseContext, ParserAdapter, ParserName, ParserStatus } from "../core/types.js";

export interface AdapterBenchmarkRow {
  readonly parser: ParserName;
  readonly iterations: number;
  readonly totalMs: number;
  readonly averageMs: number;
  readonly statuses: Readonly<Record<ParserStatus, number>>;
}

export async function benchmarkAdapters(
  adapters: readonly ParserAdapter[],
  source: string,
  context: ParseContext,
  iterations: number,
): Promise<readonly AdapterBenchmarkRow[]> {
  const rows: AdapterBenchmarkRow[] = [];
  for (const adapter of adapters) {
    const start = performance.now();
    const statuses = emptyStatusCounts();
    for (let index = 0; index < iterations; index += 1) {
      const result = await adapter.parse(source, context);
      statuses[result.status] += 1;
    }
    const totalMs = performance.now() - start;
    rows.push({
      parser: adapter.name,
      iterations,
      totalMs,
      averageMs: totalMs / iterations,
      statuses,
    });
  }
  return rows;
}

export function formatAdapterBenchmark(rows: readonly AdapterBenchmarkRow[]): string {
  const lines = [
    "| Parser | Iterations | Total ms | Avg ms | Status counts |",
    "| --- | ---: | ---: | ---: | --- |",
  ];
  for (const row of rows) {
    lines.push(
      [
        row.parser,
        String(row.iterations),
        row.totalMs.toFixed(1),
        row.averageMs.toFixed(1),
        formatStatusCounts(row.statuses),
      ].join(" | "),
    );
  }
  return `${lines.join("\n")}\n`;
}

function emptyStatusCounts(): Record<ParserStatus, number> {
  return {
    accepted: 0,
    accepted_with_errors: 0,
    rejected: 0,
    crashed: 0,
    timed_out: 0,
    unsupported: 0,
  };
}

function formatStatusCounts(statuses: Readonly<Record<ParserStatus, number>>): string {
  return Object.entries(statuses)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${status}:${count}`)
    .join(", ");
}
