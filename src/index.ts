export { generateCase } from "./generator/generator.js";
export { loadSpecCorpus, normalizeSpecExample } from "./generator/specCorpus.js";
export { createDefaultAdapters } from "./parsers/index.js";
export { findingFingerprint, runDifferentialCase } from "./runner/differential.js";
export { minimizeText } from "./runner/shrink.js";
export { collectCssFiles, formatReplayMarkdown, replayCssFiles } from "./runner/replay.js";
export { fetchCsswgSpecs } from "./specs/fetchCsswg.js";
export type {
  CssSyntax,
  DifferentialFinding,
  FuzzCase,
  ParserAdapter,
  ParseResult,
  ParserStatus,
} from "./core/types.js";
