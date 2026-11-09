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
  TACTICAL_FEATURE_NAMES,
  TACTICAL_FEATURE_CATEGORY_MAP,
  TacticalFeatureName,
  TacticalFeatureCategory,
  R4_PRESET_TACTICAL_WEIGHTS,
} from "./Gen9LearnableTacticalPolicy.js";

/**
 * 20次元戦術特徴量の完全定義情報
 */
export interface TacticalFeatureDefinition {
  readonly index: number;
  readonly id: string;
  readonly name: TacticalFeatureName;
  readonly category: TacticalFeatureCategory;
  readonly descriptionJa: string;
}

/**
 * Gen 9 20次元戦術特徴量の正本定義 (Gen9LearnableTacticalPolicy.ts に完全準拠)
 */
export const GEN9_TACTICAL_FEATURE_DEFINITIONS: readonly TacticalFeatureDefinition[] = Object.freeze([
  { index: 0, id: "t00", name: "t00_pass_certain_lethal", category: "CERTAIN_DAMAGE", descriptionJa: "PASS時の確定致死ダメージリスク" },
  { index: 1, id: "t01", name: "t01_pass_certain_severe_ratio", category: "CERTAIN_DAMAGE", descriptionJa: "PASS時の確定重度ダメージ比率" },
  { index: 2, id: "t02", name: "t02_pass_certain_moderate", category: "CERTAIN_DAMAGE", descriptionJa: "PASS時の確定中度ダメージ" },
  { index: 3, id: "t03", name: "t03_pass_estimated_lethal_risk", category: "ESTIMATED_DAMAGE", descriptionJa: "PASS時の推定致死ダメージリスク" },
  { index: 4, id: "t04", name: "t04_pass_estimated_severe_ratio", category: "ESTIMATED_DAMAGE", descriptionJa: "PASS時の推定重度ダメージ比率" },
  { index: 5, id: "t05", name: "t05_pass_estimated_moderate", category: "ESTIMATED_DAMAGE", descriptionJa: "PASS時の推定中度ダメージ" },
  { index: 6, id: "t06", name: "t06_counter_certain_lethal_prevent", category: "COUNTER_PREVENTION", descriptionJa: "Counterによる確定致死ダメージ阻止" },
  { index: 7, id: "t07", name: "t07_counter_estimated_lethal_prevent", category: "COUNTER_PREVENTION", descriptionJa: "Counterによる推定致死ダメージ阻止" },
  { index: 8, id: "t08", name: "t08_counter_damage_prevent_scaled", category: "COUNTER_PREVENTION", descriptionJa: "Counterによるダメージ阻止量" },
  { index: 9, id: "t09", name: "t09_counter_uncertain_cancel", category: "COUNTER_PREVENTION", descriptionJa: "不確実なCounter阻止期待値" },
  { index: 10, id: "t10", name: "t10_attack_unblocked_nonlethal", category: "COMBAT_OUTCOME", descriptionJa: "非致死未ブロック攻撃期待値" },
  { index: 11, id: "t11", name: "t11_attack_numerical_advantage", category: "COMBAT_OUTCOME", descriptionJa: "攻撃時の頭数優位性" },
  { index: 12, id: "t12", name: "t12_attack_favorable_or_equal_trade", category: "COMBAT_OUTCOME", descriptionJa: "有利または同等トレード攻撃" },
  { index: 13, id: "t13", name: "t13_attack_suicide_scaled", category: "COMBAT_OUTCOME", descriptionJa: "不利・自爆攻撃ペナルティ" },
  { index: 14, id: "t14", name: "t14_block_trade_advantage", category: "COMBAT_OUTCOME", descriptionJa: "ブロックによるトレード優位" },
  { index: 15, id: "t15", name: "t15_block_unblocked_lethal", category: "COMBAT_OUTCOME", descriptionJa: "未ブロック時の致死リスク" },
  { index: 16, id: "t16", name: "t16_block_unblocked_danger_ratio", category: "COMBAT_OUTCOME", descriptionJa: "未ブロック時の危険度" },
  { index: 17, id: "t17", name: "t17_survival_critical_life_board_build", category: "SURVIVAL", descriptionJa: "低ライフ時の兵士召喚・防壁設置" },
  { index: 18, id: "t18", name: "t18_attack_unblocked_lethal", category: "LETHAL_OPPORTUNITY", descriptionJa: "未ブロック攻撃による致死機会" },
  { index: 19, id: "t19", name: "t19_attack_breakthrough_lethal", category: "LETHAL_OPPORTUNITY", descriptionJa: "突破による致死機会" },
]);

/**
 * 重み配列と特徴量定義をマッピングした詳細表現を生成
 */
export function formatTacticalWeightsWithDefinitions(
  weights: readonly number[]
): Array<TacticalFeatureDefinition & { weight: number }> {
  validateBenchmarkWeights(weights);
  return GEN9_TACTICAL_FEATURE_DEFINITIONS.map((def, i) => ({
    ...def,
    weight: weights[i],
  }));
}

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
 * 20次元戦術特徴量の完全な定義および4個体の重みを正本からMarkdown表形式で生成する純粋関数 (Work 5-4B R3 修正D)
 */
export function generateTacticalWeightsMarkdownTable(): string {
  const headers = [
    "ID",
    "特徴量キー名",
    "カテゴリ",
    "日本語説明",
    "R4",
    "G0 IND2",
    "G0 IND7",
    "G3 IND3",
  ];
  const separator = ["---", "---", "---", "---", "---:", "---:", "---:", "---:"];
  const rows: string[] = [
    `| ${headers.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
  ];

  for (let i = 0; i < TACTICAL_FEATURE_DIMENSION; i++) {
    const def = GEN9_TACTICAL_FEATURE_DEFINITIONS[i];
    const r4 = R4_PRESET_TACTICAL_WEIGHTS[i];
    const g0Ind2 = G0_IND2_WEIGHTS[i];
    const g0Ind7 = G0_IND7_WEIGHTS[i];
    const g3Ind3 = G3_IND3_WEIGHTS[i];

    const formatNum = (n: number) => (n > 0 ? `+${n}` : `${n}`);

    rows.push(
      `| \`${def.id}\` | \`${def.name}\` | \`${def.category}\` | ${def.descriptionJa} | ${formatNum(r4)} | ${formatNum(g0Ind2)} | ${formatNum(g0Ind7)} | ${formatNum(g3Ind3)} |`
    );
  }

  return rows.join("\n");
}

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
