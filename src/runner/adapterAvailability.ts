import {
  parserNames,
  type ParseContext,
  type ParserAdapter,
  type ParserName,
} from "../core/types.js";

export interface AdapterAvailabilityFailure {
  readonly parser: ParserName;
  readonly reason: string;
}

export interface AdapterAvailabilityResult {
  readonly checkedParsers: readonly ParserName[];
  readonly failures: readonly AdapterAvailabilityFailure[];
}

const smokeSource = "a { color: red; }\n";

export async function verifyRequiredAdapters(
  adapters: readonly ParserAdapter[],
  context: ParseContext,
  requiredParsers: readonly ParserName[] = parserNames,
): Promise<AdapterAvailabilityResult> {
  const adaptersByName = new Map(adapters.map((adapter) => [adapter.name, adapter]));
  const failures: AdapterAvailabilityFailure[] = [];

  for (const parser of requiredParsers) {
    const adapter = adaptersByName.get(parser);
    if (adapter === undefined) {
      failures.push({ parser, reason: "adapter is missing" });
      continue;
    }
    const result = await adapter.parse(smokeSource, context);
    if (result.status !== "accepted") {
      failures.push({
        parser,
        reason:
          result.message === undefined
            ? `smoke parse returned ${result.status}`
            : `smoke parse returned ${result.status}: ${firstLine(result.message)}`,
      });
    }
  }

  return { checkedParsers: requiredParsers, failures };
}

export function assertRequiredAdaptersAvailable(result: AdapterAvailabilityResult): void {
  if (result.failures.length === 0) {
    return;
  }
  throw new Error(formatAdapterAvailabilityFailures(result));
}

export function formatAdapterAvailabilityFailures(result: AdapterAvailabilityResult): string {
  const lines = ["Required parser adapters are not all available:"];
  for (const failure of result.failures) {
    lines.push(`- ${failure.parser}: ${failure.reason}`);
  }
  return lines.join("\n");
}

function firstLine(value: string): string {
  return value.split("\n")[0] ?? value;
}
