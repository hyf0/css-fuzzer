import type { ParserAdapter } from "../core/types.js";
import { runJsParserWorker } from "./jsWorker.js";

export function createLightningCssAdapter(): ParserAdapter {
  return {
    name: "lightningcss",
    async parse(source, context) {
      return await runJsParserWorker("lightningcss", source, context);
    },
  };
}
