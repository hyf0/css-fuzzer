import { describe, expect, test } from "vite-plus/test";
import { Prng } from "../src/core/prng.js";

describe("Prng", () => {
  test("is deterministic for the same seed", () => {
    const a = new Prng(42n);
    const b = new Prng(42n);
    expect(Array.from({ length: 8 }, () => a.nextUint32())).toEqual(
      Array.from({ length: 8 }, () => b.nextUint32()),
    );
  });

  test("picks values from a non-empty list", () => {
    const prng = new Prng(1n);
    expect(["a", "b", "c"]).toContain(prng.pick(["a", "b", "c"]));
  });
});
