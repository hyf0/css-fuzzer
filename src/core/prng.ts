export interface WeightedChoice<T> {
  readonly weight: number;
  readonly value: T;
}

export class Prng {
  #state: bigint;

  constructor(seed: bigint | number | string) {
    const parsed = typeof seed === "bigint" ? seed : BigInt(seed);
    this.#state = parsed & 0xffffffffffffffffn;
  }

  fork(label: string): Prng {
    const labelSeed = [...Buffer.from(label)].reduce((acc, byte) => acc + BigInt(byte), 0n);
    return new Prng(this.nextBigInt() ^ labelSeed);
  }

  nextBigInt(): bigint {
    this.#state = (this.#state + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
    let z = this.#state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
    return z ^ (z >> 31n);
  }

  nextUint32(): number {
    return Number(this.nextBigInt() & 0xffffffffn);
  }

  float(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  int(minInclusive: number, maxInclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive)) {
      throw new TypeError("Prng.int bounds must be integers");
    }
    if (maxInclusive < minInclusive) {
      throw new RangeError(`Invalid integer range ${minInclusive}..${maxInclusive}`);
    }
    const span = maxInclusive - minInclusive + 1;
    return minInclusive + (this.nextUint32() % span);
  }

  chance(probability: number): boolean {
    if (probability < 0 || probability > 1) {
      throw new RangeError(`Probability must be between 0 and 1, got ${probability}`);
    }
    return this.float() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError("Cannot pick from an empty array");
    }
    const item = items[this.int(0, items.length - 1)];
    if (item === undefined) {
      throw new Error("PRNG picked an impossible array slot");
    }
    return item;
  }

  weighted<T>(choices: readonly WeightedChoice<T>[]): T {
    const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
    if (total <= 0) {
      throw new RangeError("Weighted choices must have positive total weight");
    }
    let target = this.float() * total;
    for (const choice of choices) {
      target -= choice.weight;
      if (target <= 0) {
        return choice.value;
      }
    }
    const last = choices.at(-1);
    if (last === undefined) {
      throw new RangeError("Cannot choose from an empty weighted array");
    }
    return last.value;
  }
}
