import { FirstLegalPolicy } from "../engine/simulation/DecisionPolicy";

/**
 * 常に最初の合法手（インデックス 0）を選択する確定的なポリシー。
 * engine/simulation/DecisionPolicy.ts の FirstLegalPolicy を再利用します。
 */
export class FirstLegalPatternPolicy extends FirstLegalPolicy {
  constructor() {
    super(false);
  }
}
