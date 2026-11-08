/**
 * Gen9BenchmarkWeights.ts
 *
 * BlackPoker Simulator - Gen 9 ベンチマーク・診断用確定戦術重み (SSOT)
 *
 * 【設計原則】
 * 1. Work 5-2 R2 および Work 5-3、Work 5-4A における確定重みを一元管理する正本 (SSOT)。
 * 2. 今後の評価スクリプト等で戦術重みの誤コピーが再発するのを恒久的に防止する。
 * 3. 各重み配列は 20 次元すべてが厳格に Object.freeze され、変更不可能。
 *
 * 【重み仕様】
 * - G0_IND2_WEIGHTS : Gen 9 G0 人手設計最良個体 (gen9-g0-ind2-counter-selective)
 * - G0_IND7_WEIGHTS : Gen 9 G0 人手設計同率最良・G3親個体 (gen9-g0-ind7-survival-trade)
 * - G3_IND3_WEIGHTS : Gen 9 G3 進化最良個体 (gen9-evolved-g3-ind3)
 */

import {
  TACTICAL_FEATURE_DIMENSION,
  R4_PRESET_TACTICAL_WEIGHTS,
} from "./Gen9LearnableTacticalPolicy.js";

/**
 * Gen 9 G0 人手設計最良個体 (gen9-g0-ind2-counter-selective)
 * 特徴: Counter重視、攻撃・ブロックは控えめ
 */
export const G0_IND2_WEIGHTS: readonly number[] = Object.freeze([
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0,          // t00..t05 (PASS損害)
  +2.6, +2.0, +1.1, +0.15,                // t06..t09 (Counter阻止)
  0.0, 0.0, 0.0, -0.30, 0.0, -2.5, 0.0,  // t10..t16 (戦闘・ブロック)
  0.0,                                    // t17 (生存)
  +2.0, +2.5,                             // t18..t19 (リーサル機会)
]);

/**
 * Gen 9 G0 人手設計同率最良・G3親個体 (gen9-g0-ind7-survival-trade)
 * 特徴: 生存・盤面構築・トレード最適化重視
 */
export const G0_IND7_WEIGHTS: readonly number[] = Object.freeze([
  -0.20, -0.05, 0.0, -0.15, 0.0, 0.0,     // t00..t05 (PASS損害)
  +2.6, +2.0, +1.1, +0.15,                // t06..t09 (Counter阻止)
  +0.10, +0.20, +0.05, -0.38, +0.22, -3.0, -0.40, // t10..t16 (戦闘・ブロック)
  +0.15,                                  // t17 (生存)
  +2.0, +2.5,                             // t18..t19 (リーサル機会)
]);

/**
 * Gen 9 G3 進化最良個体 (gen9-evolved-g3-ind3)
 * 特徴: G0_IND7 から交叉・突然変異によって選抜された最良進化個体
 */
export const G3_IND3_WEIGHTS: readonly number[] = Object.freeze([
  0.0, 0.0, 0.0, -0.0756, 0.0, -0.0132,   // t00..t05 (PASS損害)
  +2.7222, +1.7719, +1.1, +0.0319,        // t06..t09 (Counter阻止)
  +0.10, +0.154, +0.05, -0.3243, +0.22, -3.0, -0.40, // t10..t16 (戦闘・ブロック)
  +0.15,                                  // t17 (生存)
  +1.8984, +2.5,                          // t18..t19 (リーサル機会)
]);

export { R4_PRESET_TACTICAL_WEIGHTS };

/**
 * 個体識別名と重み配列のマップ
 */
export const BENCHMARK_TACTICAL_WEIGHTS_MAP: Readonly<
  Record<"R4" | "G0_IND2" | "G0_IND7" | "G3_IND3", readonly number[]>
> = Object.freeze({
  R4: R4_PRESET_TACTICAL_WEIGHTS,
  G0_IND2: G0_IND2_WEIGHTS,
  G0_IND7: G0_IND7_WEIGHTS,
  G3_IND3: G3_IND3_WEIGHTS,
});

/**
 * 重み配列の妥当性検証 (20次元、有限値)
 */
export function validateBenchmarkWeights(
  weights: readonly number[],
  expectedDimension: number = TACTICAL_FEATURE_DIMENSION
): void {
  if (!Array.isArray(weights) || weights.length !== expectedDimension) {
    throw new Error(
      `戦術重み配列の次元数が不正です: 期待値=${expectedDimension}, 実際=${weights?.length}`
    );
  }
  for (let i = 0; i < weights.length; i++) {
    if (typeof weights[i] !== "number" || !Number.isFinite(weights[i])) {
      throw new Error(`戦術重み index=${i} が有限な数値ではありません: ${weights[i]}`);
    }
  }
}

// 起動時に全重みを自己検証
validateBenchmarkWeights(G0_IND2_WEIGHTS);
validateBenchmarkWeights(G0_IND7_WEIGHTS);
validateBenchmarkWeights(G3_IND3_WEIGHTS);
validateBenchmarkWeights(R4_PRESET_TACTICAL_WEIGHTS);
