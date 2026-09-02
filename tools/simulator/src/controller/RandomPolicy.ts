import { BlackPokerPolicy, PolicyDescriptor } from "./BlackPokerPolicy";
import { DecisionRequest } from "../domain/decision/DecisionRequest";
import { DecisionResponse } from "../domain/decision/DecisionResponse";
import { RandomSource, SeededRandom } from "../engine/random/RandomSource";

/**
 * 注入可能な乱数生成器（または SeededRandom / 乱数生成関数）を用いてランダムに合法手を選択するポリシー。
 */
export class RandomPolicy implements BlackPokerPolicy {
  readonly descriptor: PolicyDescriptor;
  private readonly rng: RandomSource;

  constructor(rngOrSeedOrFn?: RandomSource | number | (() => number), name?: string) {
    if (typeof rngOrSeedOrFn === "number") {
      this.rng = new SeededRandom(rngOrSeedOrFn);
    } else if (typeof rngOrSeedOrFn === "function") {
      const fn = rngOrSeedOrFn;
      this.rng = {
        seed: 0,
        next: fn,
        nextInt: (min: number, max: number) => {
          const r = fn();
          return Math.floor(r * (max - min + 1)) + min;
        },
        choice: <T>(arr: readonly T[]) => (arr.length ? arr[Math.floor(fn() * arr.length)] : undefined),
        fork: () => this.rng,
      };
    } else if (rngOrSeedOrFn) {
      this.rng = rngOrSeedOrFn;
    } else {
      this.rng = new SeededRandom(0);
    }

    this.descriptor = {
      kind: "random",
      policyVersion: 1,
      name: name ?? `RandomPolicy(seed=${this.rng.seed})`,
      metadata: { seed: this.rng.seed },
    };
  }

  choose(request: Readonly<DecisionRequest>): DecisionResponse {
    if (!request.patterns || request.patterns.length === 0) {
      throw new Error(`選択可能な合法パターンが存在しません (DecisionId: ${request.decisionId})`);
    }

    const randomIndex = this.rng.nextInt(0, request.patterns.length - 1);
    const clampedIndex = Math.max(0, Math.min(randomIndex, request.patterns.length - 1));

    return {
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: clampedIndex,
    };
  }

  async decide(request: Readonly<DecisionRequest>): Promise<DecisionResponse> {
    return this.choose(request);
  }
}
