export interface MinimizeResult {
  readonly source: string;
  readonly attempts: number;
}

export interface MinimizeOptions {
  readonly maxPasses?: number;
  readonly maxAttempts?: number;
  readonly allowByteLevel?: boolean;
}

export async function minimizeText(
  source: string,
  isInteresting: (candidate: string) => Promise<boolean>,
  options: MinimizeOptions = {},
): Promise<MinimizeResult> {
  let attempts = 0;
  const maxPasses = options.maxPasses ?? 8;
  const maxAttempts = options.maxAttempts ?? 200;
  const structured = await simplifyCssStructure(source, isInteresting, maxAttempts);
  attempts += structured.attempts;
  const whitespace = await simplifyWhitespace(
    structured.source,
    isInteresting,
    maxAttempts - attempts,
  );
  attempts += whitespace.attempts;
  let current = whitespace.source;

  if (options.allowByteLevel === false) {
    return { source: current.trimEnd(), attempts };
  }

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    for (const granularity of chunkGranularities(current.length)) {
      let offset = 0;
      while (offset < current.length) {
        if (attempts >= maxAttempts) {
          return { source: current.trimEnd(), attempts };
        }
        const candidate = `${current.slice(0, offset)}${current.slice(offset + granularity)}`;
        attempts += 1;
        if (candidate.trim().length > 0 && (await isInteresting(candidate))) {
          current = candidate;
          changed = true;
          continue;
        }
        offset += granularity;
      }
    }
    if (!changed) {
      break;
    }
  }

  return { source: current.trimEnd(), attempts };
}

async function simplifyCssStructure(
  source: string,
  isInteresting: (candidate: string) => Promise<boolean>,
  maxAttempts: number,
): Promise<MinimizeResult> {
  let current = source;
  let attempts = 0;

  for (const item of splitTopLevelItems(current)) {
    if (attempts >= maxAttempts) {
      return { source: current.trimEnd(), attempts };
    }
    attempts += 1;
    if (item.trim().length > 0 && (await isInteresting(item))) {
      current = item;
      break;
    }
  }

  const simpleBody = await simplifyFirstBlockBody(current, isInteresting, maxAttempts - attempts);
  attempts += simpleBody.attempts;
  current = simpleBody.source;

  return { source: current.trimEnd(), attempts };
}

async function simplifyFirstBlockBody(
  source: string,
  isInteresting: (candidate: string) => Promise<boolean>,
  remainingAttempts: number,
): Promise<MinimizeResult> {
  const block = firstOuterBlock(source);
  if (block === undefined || remainingAttempts <= 0) {
    return { source, attempts: 0 };
  }

  let attempts = 0;
  const prelude = source.slice(0, block.open).trim();
  const body = source.slice(block.open + 1, block.close);
  const suffix = source.slice(block.close + 1).trim();
  const bodyItems = splitTopLevelItems(body).filter((item) => item.trim().length > 0);

  const replacement = `${prelude} { color: red; }${suffix === "" ? "" : ` ${suffix}`}`;
  attempts += 1;
  if (await isInteresting(replacement)) {
    return { source: replacement, attempts };
  }

  for (const item of bodyItems) {
    if (attempts >= remainingAttempts) {
      return { source, attempts };
    }
    attempts += 1;
    const candidate = `${prelude} { ${ensureSemicolon(item.trim())} }${suffix === "" ? "" : ` ${suffix}`}`;
    if (await isInteresting(candidate)) {
      return { source: candidate, attempts };
    }
  }

  return { source, attempts };
}

async function simplifyWhitespace(
  source: string,
  isInteresting: (candidate: string) => Promise<boolean>,
  remainingAttempts: number,
): Promise<MinimizeResult> {
  if (remainingAttempts <= 0) {
    return { source, attempts: 0 };
  }

  let attempts = 0;
  const candidates = [
    source.replaceAll(/\s+/g, " "),
    source.replaceAll(/\s*([{}:;,()>+~])\s*/g, "$1"),
    source.replaceAll(/\n\s*/g, ""),
  ];

  for (const candidate of candidates) {
    if (attempts >= remainingAttempts) {
      return { source, attempts };
    }
    attempts += 1;
    if (candidate.trim().length > 0 && (await isInteresting(candidate))) {
      return { source: candidate, attempts };
    }
  }
  return { source, attempts };
}

function chunkGranularities(length: number): readonly number[] {
  const values: number[] = [];
  for (let size = Math.max(1, Math.floor(length / 2)); size >= 1; size = Math.floor(size / 2)) {
    values.push(size);
    if (size === 1) {
      break;
    }
  }
  return values;
}

function splitTopLevelItems(source: string): readonly string[] {
  const items: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | undefined;
  let inComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inComment) {
      if (char === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== undefined) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        items.push(source.slice(start, index + 1));
        start = index + 1;
      }
      continue;
    }
    if (char === ";" && depth === 0) {
      items.push(source.slice(start, index + 1));
      start = index + 1;
    }
  }

  const tail = source.slice(start).trim();
  if (tail !== "") {
    items.push(tail);
  }
  return items;
}

function firstOuterBlock(
  source: string,
): { readonly open: number; readonly close: number } | undefined {
  let quote: string | undefined;
  let inComment = false;
  let open = -1;
  let depth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inComment) {
      if (char === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== undefined) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") {
      if (depth === 0) {
        open = index;
      }
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && open !== -1) {
        return { open, close: index };
      }
    }
  }

  return undefined;
}

function ensureSemicolon(source: string): string {
  return source.endsWith(";") || source.endsWith("}") ? source : `${source};`;
}
