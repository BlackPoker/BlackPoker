/**
 * Genetic Random Utilities (BP-SIM-AI-GENETIC-OPERATORS-DESIGN-V1-R2 / BP-SIM-AI-GENETIC-OPERATORS-V1)
 *
 * 遺伝的操作子（Crossover, Mutation）専用の決定論的乱数ワード変換ユーティリティ。
 *
 * 契約規約:
 * 1. nextUint32V1: 1 回の呼び出しで正確に 1 回の rng.next() を消費し、[0, 2^32-1] の uint32 を生成。
 * 2. nextUint16V1: 1 回の呼び出しで正確に 1 回の PRNG draw を消費し、上位 16 ビット (upper 16 bits) を返却。
 * 3. rng.nextInt() の raw word 生成使用は厳禁。
 */

import { RandomSource } from "../random/RandomSource";

/**
 * RandomSource から 32-bit 符号なし整数 (uint32) を生成する Canonical 変換関数
 * 1 回の呼出で正確に 1 回の rng.next() を消費します。
 */
export function nextUint32V1(rng: RandomSource): number {
  return Math.floor(rng.next() * 4294967296) >>> 0;
}

/**
 * Irwin-Hall 正規分布近似ノイズ生成用の 16-bit 整数乱数を生成する Canonical 変換関数
 * 1 回の呼出で正確に 1 回の PRNG draw を消費し、上位 16 ビット (upper 16 bits) を返却します。
 */
export function nextUint16V1(rng: RandomSource): number {
  return nextUint32V1(rng) >>> 16;
}
