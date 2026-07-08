import type { ParserAdapter } from "../core/types.js";
import { runJsParserWorker } from "./jsWorker.js";

export function createPostcssAdapter(): ParserAdapter {
  return {
    name: "postcss",
    async parse(source, context) {
      return await runJsParserWorker("postcss", source, context);
    },
  };
}
