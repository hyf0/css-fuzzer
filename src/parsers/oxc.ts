import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  isParserStatus,
  type ParserAdapter,
  type ParseContext,
  type ParserStatus,
} from "../core/types.js";
import { errorMessage, result, timed } from "./utils.js";

interface OxcDriverResponse {
  readonly status: ParserStatus;
  readonly message?: string | null;
  readonly recoverableErrors?: number;
}

export function createOxcCssParserAdapter(binaryPath = defaultOxcDriverPath()): ParserAdapter {
  return {
    name: "oxc-css-parser",
    async parse(source, context) {
      if (!existsSync(binaryPath)) {
        return result(
          "oxc-css-parser",
          "unsupported",
          0,
          `OXC driver binary not found at ${binaryPath}. Run "vp run build:oxc-driver" or set OXC_CSS_PARSER_BIN.`,
        );
      }

      try {
        const { value, durationMs } = await timed(() => runOxcDriver(binaryPath, source, context));
        const message = typeof value.message === "string" ? value.message : undefined;
        return result("oxc-css-parser", value.status, durationMs, message, value);
      } catch (error) {
        return result("oxc-css-parser", "crashed", 0, errorMessage(error));
      }
    },
  };
}

function defaultOxcDriverPath(): string {
  return (
    process.env.OXC_CSS_PARSER_BIN ??
    path.join(process.cwd(), "tools/oxc-css-parser-driver/target/release/oxc-css-parser-driver")
  );
}

async function runOxcDriver(
  binaryPath: string,
  source: string,
  context: ParseContext,
): Promise<OxcDriverResponse> {
  return await new Promise<OxcDriverResponse>((resolve, reject) => {
    let settled = false;
    const child = spawn(binaryPath, ["--syntax", context.syntax], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      settled = true;
      child.kill("SIGKILL");
      resolve({ status: "timed_out", message: `Timed out after ${context.timeoutMs}ms` });
    }, context.timeoutMs);

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        resolve({
          status: "crashed",
          message:
            Buffer.concat(stderr).toString("utf8") ||
            `Driver exited with code ${code ?? "unknown"}`,
        });
        return;
      }
      try {
        resolve(parseOxcDriverResponse(Buffer.concat(stdout).toString("utf8")));
      } catch (error) {
        reject(new Error(`Invalid OXC driver JSON: ${errorMessage(error)}`));
      }
    });

    child.stdin.end(source);
  });
}

export function parseOxcDriverResponse(text: string): OxcDriverResponse {
  const parsed = JSON.parse(text) as {
    readonly status?: unknown;
    readonly message?: unknown;
    readonly recoverableErrors?: unknown;
  };
  if (!isParserStatus(parsed.status)) {
    throw new Error(`Invalid OXC driver status "${String(parsed.status)}"`);
  }
  if (
    parsed.message !== undefined &&
    parsed.message !== null &&
    typeof parsed.message !== "string"
  ) {
    throw new Error("Invalid OXC driver message");
  }
  const recoverableErrors = parsed.recoverableErrors;
  if (
    recoverableErrors !== undefined &&
    (typeof recoverableErrors !== "number" ||
      !Number.isSafeInteger(recoverableErrors) ||
      recoverableErrors < 0)
  ) {
    throw new Error("Invalid OXC driver recoverableErrors");
  }
  return {
    status: parsed.status,
    ...(parsed.message === undefined || parsed.message === null ? {} : { message: parsed.message }),
    ...(recoverableErrors === undefined ? {} : { recoverableErrors }),
  };
}
