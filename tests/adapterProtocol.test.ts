import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { isParserStatus } from "../src/core/types.js";
import { parseJsWorkerResponse, PersistentJsParserWorker } from "../src/parsers/jsWorker.js";
import { parseOxcDriverResponse } from "../src/parsers/oxc.js";

describe("parser adapter protocol validation", () => {
  test("validates known parser statuses at runtime", () => {
    expect(isParserStatus("accepted")).toBe(true);
    expect(isParserStatus("accepted_with_errors")).toBe(true);
    expect(isParserStatus("invalid")).toBe(false);
  });

  test("parses valid JS worker responses", () => {
    expect(
      parseJsWorkerResponse('{"status":"rejected","message":"Unexpected token"}', "postcss"),
    ).toEqual({
      status: "rejected",
      message: "Unexpected token",
    });
    expect(
      parseJsWorkerResponse(
        '{"status":"accepted","transformedSource":"a { color: red; }\\n"}',
        "lightningcss",
      ),
    ).toEqual({
      status: "accepted",
      transformedSource: "a { color: red; }\n",
    });
  });

  test("rejects malformed JS worker responses", () => {
    expect(() => parseJsWorkerResponse('{"status":"maybe"}', "postcss")).toThrow(
      "Invalid postcss worker status",
    );
    expect(() => parseJsWorkerResponse('{"status":"accepted","message":42}', "postcss")).toThrow(
      "Invalid postcss worker message",
    );
    expect(() =>
      parseJsWorkerResponse('{"status":"accepted","transformedSource":"a{}"}', "postcss"),
    ).toThrow("Unexpected postcss worker transformedSource");
    expect(() =>
      parseJsWorkerResponse('{"status":"accepted","transformedSource":42}', "lightningcss"),
    ).toThrow("Invalid lightningcss worker transformedSource");
  });

  test("restarts a persistent JS worker after malformed JSON", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "css-fuzzer-worker-protocol-"));
    const workerPath = path.join(dir, "fake-worker.mjs");
    const startCountPath = path.join(dir, "starts.txt");
    const worker = new PersistentJsParserWorker("postcss", process.execPath, workerPath);
    try {
      await writeFile(
        workerPath,
        `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
const countPath = process.env.CSS_FAKE_WORKER_STARTS;
const starts = (existsSync(countPath) ? Number(readFileSync(countPath, "utf8")) : 0) + 1;
writeFileSync(countPath, String(starts));
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  if (line.trim() === "") continue;
  process.stdout.write(starts === 1 ? '{"status":"bogus"}\\n' : '{"status":"accepted"}\\n');
}
`,
        "utf8",
      );
      process.env.CSS_FAKE_WORKER_STARTS = startCountPath;

      await expect(worker.parse("a { color: red; }", 1_000)).rejects.toThrow(
        "Invalid postcss worker JSON",
      );
      await expect(worker.parse("a { color: red; }", 1_000)).resolves.toEqual({
        status: "accepted",
      });
    } finally {
      worker.close();
      delete process.env.CSS_FAKE_WORKER_STARTS;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("parses valid OXC driver responses", () => {
    expect(
      parseOxcDriverResponse(
        '{"status":"accepted_with_errors","message":"dashed identifier is expected","recoverableErrors":1}',
      ),
    ).toEqual({
      status: "accepted_with_errors",
      message: "dashed identifier is expected",
      recoverableErrors: 1,
    });
  });

  test("rejects malformed OXC driver responses", () => {
    expect(() => parseOxcDriverResponse('{"status":"ok"}')).toThrow("Invalid OXC driver status");
    expect(() => parseOxcDriverResponse('{"status":"accepted","message":false}')).toThrow(
      "Invalid OXC driver message",
    );
    expect(() => parseOxcDriverResponse('{"status":"accepted","recoverableErrors":-1}')).toThrow(
      "Invalid OXC driver recoverableErrors",
    );
  });
});
