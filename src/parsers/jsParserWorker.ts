import { stdin } from "node:process";
import { createInterface } from "node:readline/promises";
import { transform } from "lightningcss";
import postcss from "postcss";
import * as prettier from "prettier";
import type { ParserStatus } from "../core/types.js";
import type { JsWorkerParserName } from "./jsWorker.js";
import { errorMessage } from "./utils.js";

interface WorkerResponse {
  readonly status: ParserStatus;
  readonly message?: string;
  readonly transformedSource?: string;
}

interface WorkerRequest {
  readonly source?: unknown;
}

interface PrettierDebugApi {
  parse(source: string, options: { readonly parser: string }): unknown;
}

async function main(): Promise<void> {
  const parser = parseParser(process.argv);
  if (process.argv.includes("--server")) {
    await runServer(parser);
    return;
  }
  const source = await readStdin();
  const response = await parseSource(parser, source);
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function runServer(parser: JsWorkerParserName): Promise<void> {
  const lines = createInterface({ input: stdin });
  for await (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    try {
      const request = JSON.parse(line) as WorkerRequest;
      if (typeof request.source !== "string") {
        process.stdout.write(
          `${JSON.stringify({ status: "crashed", message: "Missing source" })}\n`,
        );
        continue;
      }
      process.stdout.write(`${JSON.stringify(await parseSource(parser, request.source))}\n`);
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({ status: "crashed", message: errorMessage(error) })}\n`,
      );
    }
  }
}

async function parseSource(parser: JsWorkerParserName, source: string): Promise<WorkerResponse> {
  try {
    switch (parser) {
      case "postcss":
        postcss.parse(source, { from: undefined });
        return { status: "accepted" };
      case "prettier-css": {
        const debugApi = (prettier as { readonly __debug?: PrettierDebugApi }).__debug;
        if (debugApi === undefined) {
          return { status: "unsupported", message: "Prettier __debug.parse is unavailable" };
        }
        await debugApi.parse(source, { parser: "css" });
        return { status: "accepted" };
      }
      case "lightningcss":
        const output = transform({
          filename: "input.css",
          code: Buffer.from(source),
          minify: false,
        });
        return { status: "accepted", transformedSource: Buffer.from(output.code).toString("utf8") };
    }
  } catch (error) {
    return { status: classifyParserError(parser, error), message: errorMessage(error) };
  }
}

function classifyParserError(parser: JsWorkerParserName, error: unknown): ParserStatus {
  const name = error instanceof Error ? error.name : "";
  switch (parser) {
    case "postcss":
      return name === "CssSyntaxError" ? "rejected" : "crashed";
    case "prettier-css":
      return name === "SyntaxError" ? "rejected" : "crashed";
    case "lightningcss":
      return name === "SyntaxError" ? "rejected" : "crashed";
  }
}

function parseParser(argv: readonly string[]): JsWorkerParserName {
  const parserIndex = argv.indexOf("--parser");
  const parser = parserIndex === -1 ? undefined : argv[parserIndex + 1];
  if (parser === "postcss" || parser === "prettier-css" || parser === "lightningcss") {
    return parser;
  }
  throw new Error(`Unknown JS parser worker target "${parser ?? ""}"`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
