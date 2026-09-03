import { RandomPolicy as EngineRandomPolicy } from "../engine/simulation/DecisionPolicy";
import { RandomSource } from "../engine/random/RandomSource";

/**
 * 注入可能な乱数生成器（または SeededRandom / 乱数生成関数）を用いてランダムに合法手を選択するポリシー。
 * engine/simulation/DecisionPolicy.ts の RandomPolicy を再利用します。
 */
export class RandomPolicy extends EngineRandomPolicy {
  constructor(rngOrSeedOrFn?: RandomSource | number | (() => number), name?: string) {
    super(rngOrSeedOrFn, name);
  }
}
