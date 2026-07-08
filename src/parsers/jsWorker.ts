import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  isParserStatus,
  type ParseContext,
  type ParserName,
  type ParserStatus,
} from "../core/types.js";
import { errorMessage, result, timed } from "./utils.js";

export type JsWorkerParserName = Extract<ParserName, "postcss" | "prettier-css" | "lightningcss">;

export interface WorkerResponse {
  readonly status: ParserStatus;
  readonly message?: string;
  readonly transformedSource?: string;
}

interface PendingRequest {
  readonly source: string;
  readonly resolve: (value: WorkerResponse) => void;
  readonly reject: (error: unknown) => void;
  readonly timeoutMs: number;
}

const clients = new Map<JsWorkerParserName, PersistentJsParserWorker>();

export async function runJsParserWorker(
  parser: JsWorkerParserName,
  source: string,
  context: ParseContext,
) {
  const tsxBin = path.join(process.cwd(), "node_modules/.bin/tsx");
  const workerPath = path.join(process.cwd(), "src/parsers/jsParserWorker.ts");
  if (!existsSync(tsxBin) || !existsSync(workerPath)) {
    return result(parser, "unsupported", 0, `JS parser worker is unavailable at ${workerPath}`);
  }

  try {
    const worker = persistentWorker(parser, tsxBin, workerPath);
    const { value, durationMs } = await timed(() => worker.parse(source, context.timeoutMs));
    const detail =
      value.transformedSource === undefined
        ? undefined
        : { transformedSource: value.transformedSource };
    return result(parser, value.status, durationMs, value.message, detail);
  } catch (error) {
    return result(parser, "crashed", 0, errorMessage(error));
  }
}

export function closeJsParserWorkers(): void {
  for (const worker of clients.values()) {
    worker.close();
  }
  clients.clear();
}

export function parseJsWorkerResponse(line: string, parser: JsWorkerParserName): WorkerResponse {
  const parsed = JSON.parse(line) as {
    readonly status?: unknown;
    readonly message?: unknown;
    readonly transformedSource?: unknown;
  };
  if (!isParserStatus(parsed.status)) {
    throw new Error(`Invalid ${parser} worker status "${String(parsed.status)}"`);
  }
  if (parsed.message !== undefined && typeof parsed.message !== "string") {
    throw new Error(`Invalid ${parser} worker message`);
  }
  if (parsed.transformedSource !== undefined && parser !== "lightningcss") {
    throw new Error(`Unexpected ${parser} worker transformedSource`);
  }
  if (parsed.transformedSource !== undefined && typeof parsed.transformedSource !== "string") {
    throw new Error(`Invalid ${parser} worker transformedSource`);
  }
  return {
    status: parsed.status,
    ...(parsed.message === undefined ? {} : { message: parsed.message }),
    ...(parsed.transformedSource === undefined
      ? {}
      : { transformedSource: parsed.transformedSource }),
  };
}

function persistentWorker(
  parser: JsWorkerParserName,
  tsxBin: string,
  workerPath: string,
): PersistentJsParserWorker {
  const existing = clients.get(parser);
  if (existing !== undefined) {
    return existing;
  }
  const worker = new PersistentJsParserWorker(parser, tsxBin, workerPath);
  clients.set(parser, worker);
  return worker;
}

export class PersistentJsParserWorker {
  #child: ChildProcessWithoutNullStreams | undefined;
  #buffer = "";
  #queue: PendingRequest[] = [];
  #active: PendingRequest | undefined;
  #activeTimeout: NodeJS.Timeout | undefined;
  readonly #parser: JsWorkerParserName;
  readonly #tsxBin: string;
  readonly #workerPath: string;

  constructor(parser: JsWorkerParserName, tsxBin: string, workerPath: string) {
    this.#parser = parser;
    this.#tsxBin = tsxBin;
    this.#workerPath = workerPath;
  }

  async parse(source: string, timeoutMs: number): Promise<WorkerResponse> {
    return await new Promise<WorkerResponse>((resolve, reject) => {
      this.#queue.push({ source, resolve, reject, timeoutMs });
      this.#pump();
    });
  }

  close(): void {
    this.#clearActiveTimeout();
    const error = new Error("JS parser worker closed");
    this.#active?.reject(error);
    for (const request of this.#queue.splice(0)) {
      request.reject(error);
    }
    this.#active = undefined;
    this.#buffer = "";
    this.#child?.kill();
    this.#child = undefined;
  }

  #pump(): void {
    if (this.#active !== undefined) {
      return;
    }
    const next = this.#queue.shift();
    if (next === undefined) {
      return;
    }
    this.#active = next;
    const child = this.#ensureChild();
    this.#activeTimeout = setTimeout(() => {
      const active = this.#active;
      if (active === undefined) {
        return;
      }
      this.#active = undefined;
      this.#restart();
      active.resolve({ status: "timed_out", message: `Timed out after ${active.timeoutMs}ms` });
      this.#pump();
    }, next.timeoutMs);
    try {
      child.stdin.write(`${JSON.stringify({ source: next.source })}\n`);
    } catch (error) {
      this.#failActive(error);
    }
  }

  #ensureChild(): ChildProcessWithoutNullStreams {
    if (this.#child !== undefined) {
      return this.#child;
    }
    const child = spawn(this.#tsxBin, [this.#workerPath, "--parser", this.#parser, "--server"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => this.#handleStdout(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      if (this.#child !== child) {
        return;
      }
      this.#failActive(error);
    });
    child.on("close", (code) => {
      if (this.#child !== child) {
        return;
      }
      this.#child = undefined;
      this.#buffer = "";
      const message =
        Buffer.concat(stderr).toString("utf8") || `Worker exited with code ${code ?? "unknown"}`;
      this.#failActive(new Error(message));
    });
    this.#child = child;
    return child;
  }

  #handleStdout(chunk: Buffer): void {
    this.#buffer += chunk.toString("utf8");
    while (true) {
      const newline = this.#buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line.trim() === "") {
        continue;
      }
      const active = this.#active;
      if (active === undefined) {
        continue;
      }
      this.#active = undefined;
      this.#clearActiveTimeout();
      try {
        active.resolve(parseJsWorkerResponse(line, this.#parser));
      } catch (error) {
        this.#restart();
        active.reject(new Error(`Invalid ${this.#parser} worker JSON: ${errorMessage(error)}`));
      }
      this.#pump();
    }
  }

  #failActive(error: unknown): void {
    const active = this.#active;
    if (active === undefined) {
      return;
    }
    this.#active = undefined;
    this.#clearActiveTimeout();
    active.reject(error);
    this.#pump();
  }

  #restart(): void {
    this.#clearActiveTimeout();
    this.#child?.kill("SIGKILL");
    this.#child = undefined;
    this.#buffer = "";
  }

  #clearActiveTimeout(): void {
    if (this.#activeTimeout !== undefined) {
      clearTimeout(this.#activeTimeout);
      this.#activeTimeout = undefined;
    }
  }
}
