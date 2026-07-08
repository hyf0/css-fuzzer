import { describe, expect, test } from "vite-plus/test";
import type { ParserAdapter } from "../src/core/types.js";
import {
  assertRequiredAdaptersAvailable,
  formatAdapterAvailabilityFailures,
  verifyRequiredAdapters,
} from "../src/runner/adapterAvailability.js";

describe("required adapter availability", () => {
  test("passes when every required adapter accepts the smoke case", async () => {
    const adapters: readonly ParserAdapter[] = [
      {
        name: "postcss",
        parse: async () => ({ parser: "postcss", status: "accepted", durationMs: 1 }),
      },
      {
        name: "prettier-css",
        parse: async () => ({ parser: "prettier-css", status: "accepted", durationMs: 1 }),
      },
    ];

    const result = await verifyRequiredAdapters(adapters, { syntax: "css", timeoutMs: 100 }, [
      "postcss",
      "prettier-css",
    ]);

    expect(result.failures).toEqual([]);
    expect(() => assertRequiredAdaptersAvailable(result)).not.toThrow();
  });

  test("reports missing, unsupported, and non-accepting adapters", async () => {
    const adapters: readonly ParserAdapter[] = [
      {
        name: "postcss",
        parse: async () => ({
          parser: "postcss",
          status: "unsupported",
          durationMs: 0,
          message: "worker missing",
        }),
      },
      {
        name: "lightningcss",
        parse: async () => ({
          parser: "lightningcss",
          status: "rejected",
          durationMs: 1,
          message: "bad smoke",
        }),
      },
    ];

    const result = await verifyRequiredAdapters(adapters, { syntax: "css", timeoutMs: 100 }, [
      "postcss",
      "prettier-css",
      "lightningcss",
    ]);

    expect(result.failures).toEqual([
      { parser: "postcss", reason: "smoke parse returned unsupported: worker missing" },
      { parser: "prettier-css", reason: "adapter is missing" },
      { parser: "lightningcss", reason: "smoke parse returned rejected: bad smoke" },
    ]);
    expect(formatAdapterAvailabilityFailures(result)).toContain(
      "Required parser adapters are not all available:",
    );
    expect(() => assertRequiredAdaptersAvailable(result)).toThrow(
      "Required parser adapters are not all available:",
    );
  });
});
