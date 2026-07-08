import { describe, expect, test } from "vite-plus/test";
import { minimizeText } from "../src/runner/shrink.js";

describe("minimizeText", () => {
  test("keeps an interesting marker while deleting surrounding text", async () => {
    const result = await minimizeText("aaaa target bbbb", async (candidate) =>
      candidate.includes("target"),
    );
    expect(result.source).toBe("target");
    expect(result.attempts).toBeGreaterThan(0);
  });

  test("can keep CSS reductions readable by disabling byte-level deletion", async () => {
    const result = await minimizeText(
      ".before { color: blue; }\nmain || aside { display: block; background: red; }",
      async (candidate) =>
        candidate.includes("||") && candidate.includes("{") && candidate.includes("}"),
      { allowByteLevel: false },
    );
    expect(result.source).toBe("main || aside { color: red; }");
  });

  test("counts whitespace simplification against the attempt budget", async () => {
    const result = await minimizeText(
      "x    target",
      async (candidate) => candidate.includes("target"),
      { allowByteLevel: false, maxAttempts: 1 },
    );
    expect(result.source).toBe("x    target");
    expect(result.attempts).toBe(1);
  });
});
