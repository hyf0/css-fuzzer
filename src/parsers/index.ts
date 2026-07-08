import type { ParserAdapter } from "../core/types.js";
import { createLightningCssAdapter } from "./lightningcss.js";
import { createOxcCssParserAdapter } from "./oxc.js";
import { createPostcssAdapter } from "./postcss.js";
import { createPrettierCssAdapter } from "./prettierCss.js";

export function createDefaultAdapters(): readonly ParserAdapter[] {
  return [
    createPostcssAdapter(),
    createPrettierCssAdapter(),
    createLightningCssAdapter(),
    createOxcCssParserAdapter(),
  ];
}
