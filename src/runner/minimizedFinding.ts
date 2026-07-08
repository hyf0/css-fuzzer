import type { DifferentialFinding, MinimizedFinding } from "../core/types.js";
import { classifyFinding, preservesFindingIdentity } from "./differential.js";

export function minimizedFindingStable(minimized: MinimizedFinding): boolean {
  const original = minimized.original;
  const replayFinding = classifyFinding(
    { ...original.testCase, source: minimized.minimizedSource },
    minimized.minimizedResults,
  );
  return (
    replayFinding.interesting &&
    preservesFindingIdentity(
      original.testCase.source,
      original.results,
      minimized.minimizedSource,
      minimized.minimizedResults,
    )
  );
}

export function reportableFinding(
  original: DifferentialFinding,
  candidate: DifferentialFinding | MinimizedFinding,
): DifferentialFinding | MinimizedFinding {
  return "minimizedSource" in candidate && !minimizedFindingStable(candidate)
    ? original
    : candidate;
}
