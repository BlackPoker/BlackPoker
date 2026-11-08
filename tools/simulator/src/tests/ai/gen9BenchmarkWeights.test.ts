/**
 * gen9BenchmarkWeights.test.ts
 *
 * BlackPoker Simulator - Gen 9 確定戦術重み (SSOT) 整合性自動テスト (Work 5-4B Evidence Correction)
 *
 * 【検証目的】
 * 1. Gen9BenchmarkWeights.ts に定義された確定戦術重み (G0_IND2, G0_IND7, G3_IND3) が、
 *    正本スクリプト (run_gen9_work54a_evaluation.ts および run_gen9_sensitivity_analysis.ts) の
 *    確定値と 20 次元すべてで完全一致 (===) することを静的ソース検証により検証する。
 * 2. G0_IND7 に R4 相当の重みが誤ってコピーされていないこと (誤コピー回帰防止) を検証する。
 * 3. 各配列が 20 次元であり、凍結 (Object.isFrozen) されていることを検証する。
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  G0_IND2_WEIGHTS,
  G0_IND7_WEIGHTS,
  G3_IND3_WEIGHTS,
  R4_PRESET_TACTICAL_WEIGHTS,
  BENCHMARK_TACTICAL_WEIGHTS_MAP,
  validateBenchmarkWeights,
} from "../../engine/ai/Gen9BenchmarkWeights.js";
import { TACTICAL_FEATURE_DIMENSION } from "../../engine/ai/Gen9LearnableTacticalPolicy.js";

/**
 * TypeScript ソースファイルから配列定数の数値を抽出するパーサー
 */
function extractWeightsFromSource(source: string, varName: string): number[] {
  const regex = new RegExp(
    `export const ${varName}: readonly number\\[\\] = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\);`
  );
  const match = source.match(regex);
  if (!match) {
    throw new Error(`ソースコード内に変数 ${varName} の定義が見つかりません`);
  }
  const body = match[1];
  const lines = body.split("\n");
  const numbers: number[] = [];
  for (const line of lines) {
    const withoutComment = line.replace(/\/\/.*$/, "").trim();
    if (!withoutComment) continue;
    const parts = withoutComment.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
    for (const part of parts) {
      const num = Number(part);
      if (Number.isNaN(num)) {
        throw new Error(`数値パースエラー: "${part}" in ${varName}`);
      }
      numbers.push(num);
    }
  }
  return numbers;
}

describe("Gen9BenchmarkWeights (SSOT) 整合性自動テスト", () => {
  const rootDir = process.cwd();
  const work54aPath = path.resolve(rootDir, "scripts/run_gen9_work54a_evaluation.ts");
  const work53Path = path.resolve(rootDir, "scripts/run_gen9_sensitivity_analysis.ts");

  const work54aSource = fs.readFileSync(work54aPath, "utf-8");
  const work53Source = fs.readFileSync(work53Path, "utf-8");

  const work54a_g0_ind2 = extractWeightsFromSource(work54aSource, "G0_IND2_WEIGHTS");
  const work54a_g0_ind7 = extractWeightsFromSource(work54aSource, "G0_IND7_WEIGHTS");
  const work54a_g3_ind3 = extractWeightsFromSource(work54aSource, "G3_IND3_WEIGHTS");

  const work53_g0_ind2 = extractWeightsFromSource(work53Source, "G0_IND2_WEIGHTS");
  const work53_g0_ind7 = extractWeightsFromSource(work53Source, "G0_IND7_WEIGHTS");
  const work53_g3_ind3 = extractWeightsFromSource(work53Source, "G3_IND3_WEIGHTS");

  it("1. 各重み配列の次元数が 20 であり、Object.isFrozen で凍結されていること", () => {
    expect(G0_IND2_WEIGHTS.length).toBe(TACTICAL_FEATURE_DIMENSION);
    expect(G0_IND7_WEIGHTS.length).toBe(TACTICAL_FEATURE_DIMENSION);
    expect(G3_IND3_WEIGHTS.length).toBe(TACTICAL_FEATURE_DIMENSION);
    expect(R4_PRESET_TACTICAL_WEIGHTS.length).toBe(TACTICAL_FEATURE_DIMENSION);

    expect(Object.isFrozen(G0_IND2_WEIGHTS)).toBe(true);
    expect(Object.isFrozen(G0_IND7_WEIGHTS)).toBe(true);
    expect(Object.isFrozen(G3_IND3_WEIGHTS)).toBe(true);
    expect(Object.isFrozen(R4_PRESET_TACTICAL_WEIGHTS)).toBe(true);

    expect(() => validateBenchmarkWeights(G0_IND2_WEIGHTS)).not.toThrow();
    expect(() => validateBenchmarkWeights(G0_IND7_WEIGHTS)).not.toThrow();
    expect(() => validateBenchmarkWeights(G3_IND3_WEIGHTS)).not.toThrow();
    expect(() => validateBenchmarkWeights(R4_PRESET_TACTICAL_WEIGHTS)).not.toThrow();
  });

  it("2. G0_IND2_WEIGHTS が Work 5-4A および Work 5-3 の正本と全20次元で完全一致すること", () => {
    expect(G0_IND2_WEIGHTS.length).toBe(work54a_g0_ind2.length);
    expect(G0_IND2_WEIGHTS.length).toBe(work53_g0_ind2.length);

    for (let i = 0; i < TACTICAL_FEATURE_DIMENSION; i++) {
      expect(G0_IND2_WEIGHTS[i]).toBe(work54a_g0_ind2[i]);
      expect(G0_IND2_WEIGHTS[i]).toBe(work53_g0_ind2[i]);
    }
  });

  it("3. G0_IND7_WEIGHTS が Work 5-4A および Work 5-3 の正本と全20次元で完全一致すること", () => {
    expect(G0_IND7_WEIGHTS.length).toBe(work54a_g0_ind7.length);
    expect(G0_IND7_WEIGHTS.length).toBe(work53_g0_ind7.length);

    for (let i = 0; i < TACTICAL_FEATURE_DIMENSION; i++) {
      expect(G0_IND7_WEIGHTS[i]).toBe(work54a_g0_ind7[i]);
      expect(G0_IND7_WEIGHTS[i]).toBe(work53_g0_ind7[i]);
    }
  });

  it("4. G3_IND3_WEIGHTS が Work 5-4A および Work 5-3 の正本と全20次元で完全一致すること", () => {
    expect(G3_IND3_WEIGHTS.length).toBe(work54a_g3_ind3.length);
    expect(G3_IND3_WEIGHTS.length).toBe(work53_g3_ind3.length);

    for (let i = 0; i < TACTICAL_FEATURE_DIMENSION; i++) {
      expect(G3_IND3_WEIGHTS[i]).toBe(work54a_g3_ind3[i]);
      expect(G3_IND3_WEIGHTS[i]).toBe(work53_g3_ind3[i]);
    }
  });

  it("5. G0_IND7_WEIGHTS に R4 相当の重みが誤コピーされていないこと (誤コピー回帰防止)", () => {
    // R4 では t00 = -2.5, t01 = -0.8
    // G0_IND7 では t00 = -0.20, t01 = -0.05
    expect(G0_IND7_WEIGHTS[0]).toBe(-0.20);
    expect(G0_IND7_WEIGHTS[0]).not.toBe(R4_PRESET_TACTICAL_WEIGHTS[0]);

    expect(G0_IND7_WEIGHTS[1]).toBe(-0.05);
    expect(G0_IND7_WEIGHTS[1]).not.toBe(R4_PRESET_TACTICAL_WEIGHTS[1]);

    // G0_IND7 と R4 の完全一致はあり得ない
    expect(G0_IND7_WEIGHTS).not.toEqual(R4_PRESET_TACTICAL_WEIGHTS);
  });

  it("6. G3_IND3_WEIGHTS に進化差分が正しく反映されていること", () => {
    // G3_IND3 は G0_IND7 の子個体だが重みが微調整されている
    expect(G3_IND3_WEIGHTS[3]).toBe(-0.0756); // t03
    expect(G0_IND7_WEIGHTS[3]).toBe(-0.15);   // G0_IND7 の t03

    expect(G3_IND3_WEIGHTS[6]).toBe(2.7222);  // t06
    expect(G0_IND7_WEIGHTS[6]).toBe(2.6);     // G0_IND7 の t06

    expect(G3_IND3_WEIGHTS).not.toEqual(G0_IND7_WEIGHTS);
  });

  it("7. BENCHMARK_TACTICAL_WEIGHTS_MAP が全4個体を正しく参照していること", () => {
    expect(BENCHMARK_TACTICAL_WEIGHTS_MAP.R4).toBe(R4_PRESET_TACTICAL_WEIGHTS);
    expect(BENCHMARK_TACTICAL_WEIGHTS_MAP.G0_IND2).toBe(G0_IND2_WEIGHTS);
    expect(BENCHMARK_TACTICAL_WEIGHTS_MAP.G0_IND7).toBe(G0_IND7_WEIGHTS);
    expect(BENCHMARK_TACTICAL_WEIGHTS_MAP.G3_IND3).toBe(G3_IND3_WEIGHTS);
  });
});
