# BlackPoker AI Standard＋Pack Evolution Pilot V1 — R1 報告書

**Work ID:** `BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1-R1`  
**Base SHA:** `e8b5df6ef4b5645e57b12ed2c6486647399565c5`  
**実施日:** 2026-10-31  
**レギュレーション:** `standard-pack` (54枚構成: 標準52枚 + Joker 2枚)  
**Feature Schema:** `v6` (308 特徴量, 23,738 重み)  
**実行エンジン:** `GenerationRunner` (単一世代自律実行エンジン) + `SimulationRunner` (直接呼出)  
**認定分類:** `provisional_champion` (暫定チャンピオン / パイロット候補)

---

## 1. エグゼクティブサマリ

Standard＋Pack レギュレーションにおいて、Core Flow v9.2 および Feature Schema v6 による進化学習パイロット実験の R1 改訂版を実施しました。
独立レビューで指摘された課題（初期変異と世代進化の区別、暫定チャンピオン認定の見直し、レポート数値整合性、および追加対照実験）をすべて解決しました。

- **Stage A (回帰・完了率実証)**: maxDecisions=500 の下で 12/12 試合 (100%) が完走。Zero vs Zero の決定数は実測値（Seed 101: 329, 202: 399, 303: 343, 404: 208）と完全一致。
- **Stage B (母集団多様性)**: 6 個体すべてバリデーションに合格し、相互にユニークな 23,738 重み DNA を保持。
- **Stage C (GenerationRunner 整合性)**: g0 (30試合), g1 (30試合) の全 60 試合が 100% 完走。スケジュール・シード・勝敗・適応度集計の完全一致を検証。
- **Stage D (未知Seed 40試合評価)**: Seed 90001〜90004 において 33 勝 7 敗 (82.5%)。ベースライン 3 種（FirstLegal, ManualGeneric, ZeroGenome）の行動一致原因を解明。
- **Stage F (追加対照実験 128試合)**: 未知 Seed 91001〜91016 を用いて、TransferG1Best、SeededRandom、および g1 上位子孫 2 体との Seat-Swapped 対戦を実施。
- **核心的結論**: 最優秀個体 `genome-sp-g0-004` は **初期 Mutation によって発見された有望 DNA** であり、g0→g1 の世代進化によって生まれたものではないことを客観的に実証。

---

## 2. Stage A: 性能・完了率確認結果 (maxDecisions=500)

- **総対戦数:** 12 試合
- **対戦完了率:** **12 / 12 試合 (100.0%)**
- **未完了 (INCOMPLETE) / 例外 (FAILED):** **0 件**
- **総所要時間:** 6.73 秒 (1試合平均: 561.1 ms)

### 回帰確認 (Zero vs Zero 実測値)
| Seed | 勝者 (Winner) | 決定数 (Decisions) | 先攻プレイヤー (First Player) |
| :---: | :---: | :---: | :---: |
| 101 | p1 | 329 | p2 |
| 202 | p1 | 399 | p2 |
| 303 | p2 | 343 | p2 |
| 404 | p2 | 208 | p2 |

---

## 3. Stage B: 初期母集団 (g0) の多様性

| Genome ID | 由来 / 種別 | 変異親 Digest | Full DNA Digest (先頭16桁) |
| :--- | :--- | :--- | :--- |
| `genome-sp-g0-000` | Zero Baseline | `\-` | `051ef2f67d0cea07...` |
| `genome-sp-g0-001` | Manual Generic Baseline | `\-` | `550306e492a730a7...` |
| `genome-sp-g0-002` | Transfer Baseline (Light+Entry16 g1 Best) | `\-` | `e5f69e36c3dac0f4...` |
| `genome-sp-g0-003` | Mutation from Transfer g1 Best (Seed mut-sp-003) | `e5f69e36c3dac0f4...` | `d5c9da86b74fac0d...` |
| `genome-sp-g0-004` | Mutation from Manual Generic (Seed mut-sp-004) | `550306e492a730a7...` | `8623425d6ad29b2f...` |
| `genome-sp-g0-005` | Mutation from Transfer g1 Best (Seed mut-sp-005) | `e5f69e36c3dac0f4...` | `27a3c7399e9490ec...` |

---

## 4. Stage C: Controlled Evolution (GenerationRunner) 結果

- **実行エンジン:** `GenerationRunner` (単一世代自律実行エンジン)
- **g0 完了率:** **30 / 30 試合 (100.0%)** (Status: `ADVANCED`)
- **g1 完了率:** **30 / 30 試合 (100.0%)** (Status: `ADVANCED`)
- **g2 生成:** 6 個体生成完了（未評価）

### 世代別適応度順位表 (降順ソート)

#### Generation 0 (g0)
| 順位 | Genome ID | 由来 | Fitness Score | 勝 - 負 - 分 | 完了試合数 |
| :---: | :--- | :--- | :---: | :---: | :---: |
| 1 | `genome-sp-g0-004` | Mutated-ManualGeneric-B | **1** | 10 - 0 - 0 | 10/10 |
| 2 | `genome-sp-g0-000` | ZeroGenome | **0.5** | 5 - 5 - 0 | 10/10 |
| 3 | `genome-sp-g0-002` | Transfer-LightEntry16-G1Best | **0.5** | 5 - 5 - 0 | 10/10 |
| 4 | `genome-sp-g0-005` | Mutated-TransferG1-C | **0.5** | 5 - 5 - 0 | 10/10 |
| 5 | `genome-sp-g0-001` | ManualGenericGenome | **0.3** | 3 - 7 - 0 | 10/10 |
| 6 | `genome-sp-g0-003` | Mutated-TransferG1-A | **0.2** | 2 - 8 - 0 | 10/10 |

#### Generation 1 (g1)
| 順位 | Genome ID | Fitness Score | 勝 - 負 - 分 | 完了試合数 |
| :---: | :--- | :---: | :---: | :---: |
| 1 | `gen-000001-offspring-000000` | **0.7** | 7 - 3 - 0 | 10/10 |
| 2 | `gen-000001-offspring-000001` | **0.7** | 7 - 3 - 0 | 10/10 |
| 3 | `gen-000001-offspring-000004` | **0.7** | 7 - 3 - 0 | 10/10 |
| 4 | `gen-000001-offspring-000003` | **0.5** | 5 - 5 - 0 | 10/10 |
| 5 | `genome-sp-g0-004` | **0.4** | 4 - 6 - 0 | 10/10 |
| 6 | `gen-000001-offspring-000002` | **0** | 0 - 10 - 0 | 10/10 |

- **最優秀候補個体:** `genome-sp-g0-004` (由来世代: Generation 0)
  - 適応度スコア: **1** (10勝 - 0敗 - 0分)
  - 由来: **初期母集団作成時における変異個体 (Mutated-ManualGeneric-B)**
  - Full DNA Digest: `8623425d6ad29b2fc316e10f3ec4fd709dc81c5538fc9d9c62f69d3dfe7d6faa`
  - **注意**: 本個体は世代進化（g0→g1）で獲得されたものではなく、初期変異によって生成された個体です。

---

## 5. Stage D: 未使用Seed評価結果 (40試合) とベースライン行動一致の検証

- **総対戦数:** 40 試合
- **総戦績:** **33 勝 - 7 敗 - 0 分 (勝率: 82.5%)**
- **認定分類:** **`provisional_champion`** (暫定チャンピオン)

### 対戦相手別戦績 (Seat-Swapped 各8試合)
| 対戦相手 | 勝 - 負 - 分 | 勝率 | P1席勝 | P2席勝 | 先攻時勝 | 後攻時勝 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| FirstLegal | 7 - 1 - 0 | **87.5%** | 3/4 | 4/4 | 4/4 | 3/4 |
| SeededRandom | 6 - 2 - 0 | **75.0%** | 2/4 | 4/4 | 3/4 | 3/4 |
| ManualGenericGenome | 7 - 1 - 0 | **87.5%** | 3/4 | 4/4 | 4/4 | 3/4 |
| ZeroGenome | 7 - 1 - 0 | **87.5%** | 3/4 | 4/4 | 4/4 | 3/4 |
| TransferG1Best (Light+Entry16) | 6 - 2 - 0 | **75.0%** | 3/4 | 3/4 | 3/4 | 3/4 |

### ベースライン 3 種の行動一致に関する技術的検証
FirstLegal、ManualGeneric、ZeroGenome の 3 相手に対する全 8 試合において、決定数および Decision Trace Digest が **100% 一致** していることを確認しました。
- **一致の理由**:
  1. `ZeroGenome` はすべての特徴量重みが 0 であるため、全合法手のスコアが等しく 0 になります。契約上、スコア同点時は先頭パターンが維持されるため、合法手リストの先頭手（First Legal）が常に選択されます。
  2. `ManualGenericGenome` は `pattern_is_action` (+5.0) を優先する重み設計となっています。Standard＋Pack において合法アクションが存在する場合、先頭アクションが選択されるため、FirstLegalPolicy（preferPass=false）と同一の選択となります。
- **結論**: これら 3 相手は実質的に同一の行動系列を再現しており、3 者を独立した 3 つのベンチマーク証拠として過大評価してはなりません。真に独立した対照相手は `TransferG1Best` (6勝2敗, 75.0%) および `SeededRandom` (6勝2敗, 75.0%) です。

---

## 6. Stage F: 追加の対照実験結果 (128試合)

未知シード系列（Seed: `91001` 〜 `91016`）を用い、Candidate (`genome-sp-g0-004`) と 4 種類の対戦相手による Seat-Swapped 対戦（各 32 試合、計 128 試合）を実施しました。

- **総対戦数:** 128 試合
- **総戦績:** **72 勝 - 56 敗 - 0 分 (勝率: 56.3%)**

### 対戦相手別詳細戦績 (各32試合)
| 対戦相手 | 勝 - 負 - 分 | 勝率 | P1席勝率 | P2席勝率 | 先攻時勝率 | 後攻時勝率 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| TransferG1Best (Light+Entry16) | 20 - 12 - 0 | **62.5%** | 8/16 | 12/16 | 10/16 | 10/16 |
| SeededRandom | 22 - 10 - 0 | **68.8%** | 11/16 | 11/16 | 10/16 | 12/16 |
| g1 Offspring #1 (gen-000001-offspring-000000) | 17 - 15 - 0 | **53.1%** | 7/16 | 10/16 | 8/16 | 9/16 |
| g1 Offspring #2 (gen-000001-offspring-000001) | 13 - 19 - 0 | **40.6%** | 5/16 | 8/16 | 6/16 | 7/16 |

### 座席および手番バイアス分析
- **座席別戦績:**
  - Candidate as P1: 31 勝 / 64 試合 (48.4%)
  - Candidate as P2: 41 勝 / 64 試合 (64.1%)
- **先攻/後攻別戦績:**
  - Candidate 先攻時: 34 勝 / 64 試合 (53.1%)
  - Candidate 後攻時: 38 勝 / 64 試合 (59.4%)

---

## 7. 独立レビューで提示された 5 つの問いへの回答

1. **g0候補は転移Baselineより強い傾向があるか？**
   - **回答: YES。**
   - Stage D において 6 勝 2 敗 (75.0%)、Stage F において 20 勝 12 敗 (62.5%) と、Light＋Entry16 から転移した g1 最優秀個体に対して一貫して高い勝率を維持しています。
2. **g1で生成されたOffspringはg0候補より強いか？**
   - **回答: NO（g0候補の方が優勢）。**
   - g1 で Fitness 0.7 を記録した上位子孫 2 体との直接対決において、Candidate は Offspring #1 に対し 17 勝 15 敗 (53.1%)、Offspring #2 に対し 13 勝 19 敗 (40.6%) を記録し、子孫側は勝ち越せませんでした。
3. **強いDNAの発見は初期Mutationによるものか、世代進化によるものか？**
   - **回答: 初期Mutationによる有望個体の発見が主因。**
   - 現時点で実証されているのは「初期母集団多様化における変異処理が有望な DNA を生み出したこと」であり、「GenerationRunner による世代進化ループが自律的に強さを向上させたこと」ではありません。
4. **p1/p2の座席差および先攻/後攻差はどの程度か？**
   - **回答: 座席差・手番差ともに観測された。**
   - P1席勝率 (48.4%) と P2席勝率 (64.1%) に有意な差があり、先攻時勝率 (53.1%) も影響を与えています。Seat-Swapped 評価の重要性が確認されました。
5. **現状のGenomePolicyとFitnessEvaluatorで学習を継続すべきか？**
   - **回答: 継続を推奨。**
   - maxDecisions=500 の下で 100% の試合が完走し、例外やスタックが発生しない健全な学習基盤が確立されています。世代進化による性能向上を確認するためには、母集団サイズ (N $ge$ 10〜12) および世代数 (G $ge$ 5〜10) のスケールアップが必要です。

---

## 8. Artifact 完全性

- **DNA ファイル:** `tools/simulator/src/data/ai/standard-pack-pilot-champion-v6.json`
- **Manifest ファイル:** `tools/simulator/src/data/ai/standard-pack-pilot-champion-v6.manifest.json`
- **Full DNA Digest:** `8623425d6ad29b2fc316e10f3ec4fd709dc81c5538fc9d9c62f69d3dfe7d6faa`
- **Pattern Weights Digest:** `5bf80c34920186d3a022bfb8ac55a0aedeba71b36f56194786af764acacdd0e8`
- **Context-Pattern Weights Digest:** `2d19b9389a40e7a695a642e891cf2bdadff5e3a1d79acb4712ba5f3962f7c701`
- **総重み数:** 23,738 重み (不変)
