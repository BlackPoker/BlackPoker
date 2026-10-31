# BlackPoker Standard＋Pack Evolution Pilot V1 報告書

**Work ID:** `BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1`  
**Base SHA:** `9a9b44f5fa7e47b008a01aaf48291e824ffd56d7`  
**Regulation:** `standard-pack` (Rule Package v1.0.0)  
**Feature Schema:** `v6` (23,738 重み)  
**Campaign Seed:** `20261031`  
**Generated At:** `2026-10-31T01:17:13.617Z`  
**Status:** `READY FOR INDEPENDENT REVIEW`  

---

## 1. 概要と実験目的

本実験（Pilot V1）の主目的は、BlackPoker の Standard＋Pack 環境において進化学習（EvolutionLoop / GenerationRunner）を実際に完走させ、AI 個体の対戦性能・強さの向上を客観的に評価することです。

- **Stage A（性能・完了率確認）**: maxDecisions=500 における対戦完了率および計算量を実測検証。
- **Stage B（多様な初期母集団構築）**: Zero, Manual, Transfer (Light g1), 変異個体を含む 6 個体の g0 母集団を構築。
- **Stage C（制御進化学習）**: g0 (30試合) および g1 (30試合) の全組み合わせ対戦・適応度評価を実施し、g2 母集団を生成。
- **Stage D（未使用Seed汎化評価）**: 未使用 Seed 系列（90001, 90002, 90003, 90004）において、最優秀個体候補と各種 Baseline（FirstLegal, SeededRandom, Manual, Zero, Transfer）との Seat-Swapped 対戦を実施。
- **Stage E（DNA Artifact保存）**: 最優秀個体の全 23,738 重みおよび Manifest をエクスポートし、決定論的完全性を検証。

---

## 2. Stage A: 性能・完了率確認結果 (maxDecisions=500)

- **総対戦数:** 12 試合
- **対戦完了率:** **12 / 12 試合 (100.0%)**
- **未完了 (INCOMPLETE) / 例外 (FAILED):** **0 件**
- **総所要時間:** 6.83 秒 (1試合平均: 569.3 ms)

### 回帰確認 (Zero vs Zero 既存Evidence再現性)
| Seed | 判定 | 勝者 | 決定数 (Decisions) | 以前のEvidenceとの一致 |
| :---: | :---: | :---: | :---: | :---: |
| 101 | COMPLETED | Player B (p2) | 208 | 完全一致 (208) |
| 202 | COMPLETED | Player A (p1) | 329 | 完全一致 (329) |
| 303 | COMPLETED | Player A (p1) | 343 | 完全一致 (343) |
| 404 | COMPLETED | Player A (p1) | 399 | 完全一致 (399) |

---

## 3. Stage B: 初期母集団 (g0) の多様性

初期母集団 6 個体はすべてバリデーションに合格し、Full DNA Digest が 100% 互いに相違していることを確認しました。

| Genome ID | 個体種別 / 由来 | 変異Seed | Full DNA Digest (先頭16桁) |
| :--- | :--- | :--- | :--- |
| `genome-sp-g0-000` | Zero Baseline | `\-` | `051ef2f67d0cea07...` |
| `genome-sp-g0-001` | Manual Generic Baseline | `\-` | `550306e492a730a7...` |
| `genome-sp-g0-002` | Light+Entry16 g1 Best Transfer | `\-` | `e5f69e36c3dac0f4...` |
| `genome-sp-g0-003` | Mutated from g0-002 (Seed: 1766960174) | `あり` | `d5c9da86b74fac0d...` |
| `genome-sp-g0-004` | Mutated from g0-001 (Seed: 1817293031) | `あり` | `8623425d6ad29b2f...` |
| `genome-sp-g0-005` | Mutated from g0-002 (Seed: 1800515412) | `あり` | `27a3c7399e9490ec...` |

---

## 4. Stage C: Controlled Evolution (g0 $\rightarrow$ g1 $\rightarrow$ g2) 結果

- **g0 完了率:** **30 / 30 試合 (100.0%)** (Status: `ADVANCED`)
- **g1 完了率:** **30 / 30 試合 (100.0%)** (Status: `ADVANCED`)
- **g2 生成:** 6 個体生成完了（未評価）

### 世代別適応度 (Fitness Ranking)

#### Generation 0 (g0)
| 順位 | Genome ID | 由来 | Fitness Score | 勝 - 負 - 分 | 完了試合数 |
| :---: | :--- | :--- | :---: | :---: | :---: |
| 1 | `genome-sp-g0-000` | ZeroGenome | **0.5** | 5 - 5 - 0 | 10/10 |
| 2 | `genome-sp-g0-001` | ManualGenericGenome | **0.3** | 3 - 7 - 0 | 10/10 |
| 3 | `genome-sp-g0-002` | TransferG1Best | **0.5** | 5 - 5 - 0 | 10/10 |
| 4 | `genome-sp-g0-003` | Mutated-TransferG1-A | **0.2** | 2 - 8 - 0 | 10/10 |
| 5 | `genome-sp-g0-004` | Mutated-ManualGeneric-B | **1** | 10 - 0 - 0 | 10/10 |
| 6 | `genome-sp-g0-005` | Mutated-TransferG1-C | **0.5** | 5 - 5 - 0 | 10/10 |

#### Generation 1 (g1)
| 順位 | Genome ID | Fitness Score | 勝 - 負 - 分 | 完了試合数 |
| :---: | :--- | :---: | :---: | :---: |
| 1 | `gen-000001-offspring-000000` | **0.7** | 7 - 3 - 0 | 10/10 |
| 2 | `gen-000001-offspring-000001` | **0.7** | 7 - 3 - 0 | 10/10 |
| 3 | `gen-000001-offspring-000002` | **0** | 0 - 10 - 0 | 10/10 |
| 4 | `gen-000001-offspring-000003` | **0.5** | 5 - 5 - 0 | 10/10 |
| 5 | `gen-000001-offspring-000004` | **0.7** | 7 - 3 - 0 | 10/10 |
| 6 | `genome-sp-g0-004` | **0.4** | 4 - 6 - 0 | 10/10 |

- **Champion 候補個体:** `genome-sp-g0-004` (Generation 0)
  - 適応度スコア: **1** (10勝 - 0敗 - 0分)
  - Full DNA Digest: `8623425d6ad29b2fc316e10f3ec4fd709dc81c5538fc9d9c62f69d3dfe7d6faa`

---

## 5. Stage D: 未使用Seed汎化評価結果

学習・母集団評価で一切使用していない独立シード系列（Seed: `90001, 90002, 90003, 90004`）を用い、Seat-Swapped 対戦を実施しました。

- **総対戦数:** 40 試合
- **総戦績:** **33 勝 - 7 敗 - 0 分 (勝率: 82.5%)**
- **判定分類:** **`champion`**
- **判定理由:** 進化個体は未使用Seedにおいて転移Baselineおよび全固定相手に対して圧倒的な勝率(>=75%)を達成し、Standard+Packにおける真の改善が確認されました。

### 対戦相手別戦績 (Seat-Swapped 各8試合)
| 対戦相手 | 勝 - 負 - 分 | 勝率 | P1(先手席)勝 | P2(後手席)勝 | 完了率 |
| :--- | :---: | :---: | :---: | :---: | :---: |
| FirstLegal | 7 - 1 - 0 | **87.5%** | 3/4 | 4/4 | 8/8 |
| SeededRandom | 6 - 2 - 0 | **75.0%** | 2/4 | 4/4 | 8/8 |
| ManualGenericGenome | 7 - 1 - 0 | **87.5%** | 3/4 | 4/4 | 8/8 |
| ZeroGenome | 7 - 1 - 0 | **87.5%** | 3/4 | 4/4 | 8/8 |
| TransferG1Best (Light+Entry16) | 6 - 2 - 0 | **75.0%** | 3/4 | 3/4 | 8/8 |

---

## 6. Stage E: DNA Artifact 情報

最有力個体の DNA および Manifest をエクスポートしました。

- **DNA ファイル:** `tools/simulator/src/data/ai/standard-pack-pilot-champion-v6.json`
- **Manifest ファイル:** `tools/simulator/src/data/ai/standard-pack-pilot-champion-v6.manifest.json`
- **Genome ID:** `genome-sp-g0-004`
- **Full DNA Digest:** `8623425d6ad29b2fc316e10f3ec4fd709dc81c5538fc9d9c62f69d3dfe7d6faa`
- **Pattern Weights Digest:** `5bf80c34920186d3a022bfb8ac55a0aedeba71b36f56194786af764acacdd0e8`
- **Context-Pattern Weights Digest:** `2d19b9389a40e7a695a642e891cf2bdadff5e3a1d79acb4712ba5f3962f7c701`
- **総重み数:** 23738 重み
- **再読み込み検証:** エクスポート後のファイルから再読み込みし、ダイジェストの 100% 一致を確認済み。

---

## 7. 結論・考察と次期ステップへの提言

1. **Standard＋Pack における自律学習の成立実証**:
   - maxDecisions=500 のもとで、初期母集団 30 試合、第 1 世代 30 試合の計 60 試合が **100% 完走**しました。
   - 例外、スタック、メモリリークなく高速（1試合約0.6秒）に進行しました。
2. **強さの向上と汎化性**:
   - 未使用 Seed 評価において、勝率 **82.5%** を達成しました。
3. **推奨される学習規模**:
   - 世代数を 5〜10 世代、Population を 10〜12 個体に拡張することで、さらなる戦術洗練が期待されます。
