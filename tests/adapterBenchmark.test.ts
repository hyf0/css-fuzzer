import { describe, expect, test } from "vite-plus/test";
import type { ParserAdapter } from "../src/core/types.js";
import { benchmarkAdapters, formatAdapterBenchmark } from "../src/runner/adapterBenchmark.js";

describe("adapter benchmark", () => {
  test("records per-adapter timings and status counts", async () => {
    const adapters: readonly ParserAdapter[] = [
      {
        name: "postcss",
        parse: async () => ({ parser: "postcss", status: "accepted", durationMs: 1 }),
      },
      {
        name: "lightningcss",
        parse: async () => ({ parser: "lightningcss", status: "rejected", durationMs: 1 }),
      },
    ];

    const rows = await benchmarkAdapters(
      adapters,
      "a { color: red; }",
      { syntax: "css", timeoutMs: 100 },
      3,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      parser: "postcss",
      iterations: 3,
      statuses: { accepted: 3 },
    });
    expect(rows[1]).toMatchObject({
      parser: "lightningcss",
      iterations: 3,
      statuses: { rejected: 3 },
    });
    expect(formatAdapterBenchmark(rows)).toContain("| Parser | Iterations | Total ms | Avg ms |");
  });
});
