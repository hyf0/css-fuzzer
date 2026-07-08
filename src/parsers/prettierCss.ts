import type { ParserAdapter } from "../core/types.js";
import { runJsParserWorker } from "./jsWorker.js";

export function createPrettierCssAdapter(): ParserAdapter {
  return {
    name: "prettier-css",
    async parse(source, context) {
      return await runJsParserWorker("prettier-css", source, context);
    },
  };
}
