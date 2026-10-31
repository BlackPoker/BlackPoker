# BlackPoker AI Standard＋Pack Evolution Pilot V1 — R2 報告書

**Work ID:** `BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1-R2`  
**Base SHA:** `b01952928c8757e3553b808daa366a410476eb18`  
**実施日:** 2026-11-01  
**レギュレーション:** `standard-pack` (54枚構成: 標準52枚 + Joker 2枚)  
**Feature Schema:** `v6` (308 特徴量, 23,738 重み)  
**実行エンジン:** `SimulationRunner.run` (公式実装直接呼出)  
**評価ステータス:** **READY FOR INDEPENDENT REVIEW** (自己承認なし)

---

## 1. エグゼクティブサマリ

独立レビューで指摘された **R1 レポートの結論矛盾（Offspring #2 が g0 候補に 19勝 13敗で勝ち越していた事実の誤記・一般化）を完全に修正** し、承認された Work 1 スコープに基づき、**576 試合の Validation 評価（Stage G）** を実施しました。

- **結論矛盾の是正**:
  - Stage F 直接対決（32 試合 Seat-Swapped）において、**Offspring #2 は Candidate に 19 勝 13 敗 (勝率 59.4%) で明確に勝ち越していました**。
  - 子孫 2 体合計でも 34 勝 30 敗 (勝率 53.1%) で子孫側が上回っていました。
  - R1 レポートにおける「子孫側は勝ち越せなかった」「g0 候補の方が優勢」という記述は誤謬であり、本 R2 報告書において正式に是正・撤回します。
- **Stage G Validation 評価 (576 試合完了率 99.8%)**:
  - 未使用 Seed `92001` 〜 `92032` (32 シード、過去の全 58 シードと重複ゼロ確認済み) を用いて、3 モデル（Candidate, Offspring #2, Offspring #1）と 3 固定ベースライン（TransferG1Best, SeededRandom, FirstLegal）による完全 Seat-Swapped 対戦を実施。
  - 575 試合が正常完了、未完了 (INCOMPLETE) は 0 件、例外終了 (FAILED) は 1 件 (0.2%, Seed 92023 にて手札不正カード検出による fail-closed 例外)。
- **厳格な統計的検証 (McNemar 検定 & ペア信頼区間)**:
  - 同一条件（同一相手・同一シード・同一座席）有効 191 試合における Candidate vs Offspring #2 のペア比較を実施。
  - 不一致ペア（Candidateのみ勝 47 vs Offspringのみ勝 26）の二項検定厳密解により客観的な $p$ 値 ($p = 0.0186$) を算出。Candidate の優位性を実証。

---

## 2. Stage G: 576 試合 Validation 評価結果

### 2.1 評価対象モデルの整理
1. **Candidate** (`genome-sp-g0-004`): g0 初期変異体 (`Mutated-ManualGeneric-B`)
2. **Offspring #2** (`gen-000001-offspring-000001`): g1 Fitness 0.7 同率首位 3 体のうち事前選定 #2
3. **Offspring #1** (`gen-000001-offspring-000000`): g1 Fitness 0.7 同率首位 3 体のうち事前選定 #1
※ g1 において Offspring #1, #2, #4 は同一の Fitness 0.7 (7勝3敗) を記録した同率首位であり、評価した 2 個体は事前選定として扱っています。

### 2.2 モデル別総合戦績 (各 192 試合)

| モデル | 総対戦数 | 完了 | 失敗 (FAILED) | 勝 | 敗 | 分 | 勝率 | 95% 信頼区間 (Wilson) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Candidate** (`g0-004`) | 192 | 191 | 1 (0.5%) | **146** | 45 | 0 | **76.4%** | [69.9%, 81.9%] |
| **Offspring #2** (`g1 #2`) | 192 | 192 | 0 | **126** | 66 | 0 | **65.6%** | [58.7%, 72.0%] |
| **Offspring #1** (`g1 #1`) | 192 | 192 | 0 | **86** | 106 | 0 | **44.8%** | [37.9%, 51.9%] |

### 2.3 対戦相手別戦績 (各 64 試合 Seat-Swapped, 32 シード)

#### vs TransferG1Best (Light＋Entry16 最優秀転移個体)
| モデル | 勝 - 負 - 分 | 勝率 | 95% 信頼区間 | 両席勝 / 分割 / 両席負 | ペア平均スコア | ペアスコア 95% 信頼区間 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Candidate** | 47 - 16 - 0 | **74.6%** | [62.7%, 83.7%] | 18 / 11 / 2 | 0.516 | [0.291, 0.741] |
| **Offspring #2** | 41 - 23 - 0 | **64.1%** | [51.8%, 74.7%] | 14 / 13 / 5 | 0.281 | [0.018, 0.544] |
| **Offspring #1** | 23 - 41 - 0 | **35.9%** | [25.3%, 48.2%] | 2 / 19 / 11 | -0.281 | [-0.491, -0.072] |

#### vs SeededRandom (シード付きランダム)
| モデル | 勝 - 負 - 分 | 勝率 | 95% 信頼区間 | 両席勝 / 分割 / 両席負 | ペア平均スコア | ペアスコア 95% 信頼区間 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Candidate** | 44 - 20 - 0 | **68.8%** | [56.6%, 78.8%] | 13 / 18 / 1 | 0.375 | [0.175, 0.575] |
| **Offspring #2** | 34 - 30 - 0 | **53.1%** | [41.1%, 64.8%] | 8 / 18 / 6 | 0.063 | [-0.179, 0.304] |
| **Offspring #1** | 37 - 27 - 0 | **57.8%** | [45.6%, 69.1%] | 11 / 15 / 6 | 0.156 | [-0.105, 0.417] |

#### vs FirstLegal (決定論的合法手先頭選択)
| モデル | 勝 - 負 - 分 | 勝率 | 95% 信頼区間 | 両席勝 / 分割 / 両席負 | ペア平均スコア | ペアスコア 95% 信頼区間 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Candidate** | 55 - 9 - 0 | **85.9%** | [75.4%, 92.4%] | 23 / 9 / 0 | 0.719 | [0.554, 0.883] |
| **Offspring #2** | 51 - 13 - 0 | **79.7%** | [68.3%, 87.7%] | 21 / 9 / 2 | 0.594 | [0.372, 0.815] |
| **Offspring #1** | 26 - 38 - 0 | **40.6%** | [29.5%, 52.9%] | 5 / 16 / 11 | -0.188 | [-0.437, 0.062] |

---

## 3. 同一対戦条件におけるペア比較と McNemar 検定 (n = 192)

同一のシード・座席・対戦相手（全 192 試合条件）において、モデル間の勝敗ペアを直接比較しました。

### 3.1 Candidate vs Offspring #2 (`gen-000001-offspring-000001`)

- **分割表 (Contingency Table)**:
  - 両者勝利 ($a$): **99** 試合
  - Candidate のみ勝利 ($b$): **47** 試合
  - Offspring #2 のみ勝利 ($c$): **26** 試合
  - 両者敗北 ($d$): **19** 試合
- **検定結果**:
  - 不一致ペア数 ($b + c$): 73
  - 連続性補正 McNemar 統計量 ($chi^2$): 5.4795
  - **厳密 $p$ 値 (Exact Binomial $p$-value)**: **0.0186**
  - **判定結論**: 統計的有意差あり (p = 0.0186 < 0.05)。帰無仮説は棄却されます。

### 3.2 Candidate vs Offspring #1 (`gen-000001-offspring-000000`)

- **分割表 (Contingency Table)**:
  - 両者勝利 ($a$): **67** 試合
  - Candidate のみ勝利 ($b$): **79** 試合
  - Offspring #1 のみ勝利 ($c$): **19** 試合
  - 両者敗北 ($d$): **26** 試合
- **検定結果**:
  - 不一致ペア数 ($b + c$): 98
  - 連続性補正 McNemar 統計量 ($chi^2$): 35.5204
  - **厳密 $p$ 値 (Exact Binomial $p$-value)**: **0.0000**
  - **判定結論**: 統計的有意差あり (p = 0.0000 < 0.05)。帰無仮説は棄却されます。

---

## 4. 独立レビューで提示された問いへの改訂回答

1. **g0 候補は転移 Baseline より強いか？**
   - **回答: YES。**
   - Stage F において 20 勝 12 敗 (62.5%)、Stage G においても **47 勝 16 敗 (74.6%)** を記録し、Light＋Entry16 最優秀個体に対して一貫した優位性を実証。
2. **g1 で生成された Offspring は g0 候補より強いか？**
   - **回答: NO（直接対決では局所的に勝ち越したが、共通ベースライン対戦では Candidate の方が統計的有意に優勢）。**
   - **直接対決 (Stage F)**: Offspring #2 は Candidate に対し **19 勝 13 敗 (勝率 59.4%)** で勝ち越しました（R1 レポートの誤記は撤回）。
   - **共通ベースライン対戦 (Stage G)**: Candidate 勝率 76.4% vs Offspring #2 勝率 65.6%。同一条件 191 有効ペアの McNemar 検定では Candidate のみ勝利 47 試合 vs Offspring #2 のみ勝利 26 試合となり、$p = 0.0186 < 0.05 で Candidate の方が統計的有意に高い勝率を記録しました。したがって、直接対決での Offspring #2 の勝ち越しは局所的な相性差であり、汎用的なベースライン対戦において g1 子孫個体の方が強いとは言えません。
3. **強い DNA の獲得は初期 Mutation によるものか、世代進化によるものか？**
   - **回答: 初期 Mutation による有望個体の獲得が主因。**
   - 現時点で明確に実証されているのは「初期母集団多様化における変異処理が有望な DNA を生み出したこと」であり、1 世代の小規模進化では世代進化による全般的な性能向上を統計的に証明するには至っていません。共通ベースラインでも g0 変異個体（Candidate）が最高成績を維持しています。
4. **座席差 (p1/p2) および手番差 (先攻/後攻) はどの程度か？**
   - **回答: 座席差・手番差ともに実測された。**
   - Candidate: P1席勝率 76.8% vs P2席勝率 76.0%。先攻勝率 84.1% vs 後攻勝率 47.5%。Seat-Swapped 評価の不可欠性が再確認されました。
5. **次期 Work への学習方針の推奨**
   - **回答: Work 2 (エンジン最適化) および Work 3 (多世代 Evolution Campaign) の計画策定を推奨。**
   - 母集団サイズ ($N=12$)、世代数 ($G=10$)、エリート保存 (`eliteCount=1`)、および Hall of Fame を導入した本格的なキャンペーンへ進むことを推奨します。

---

## 5. Artifact 完全性とファイル保護

- **保護された既存ファイル (変更差分 0 件)**:
  - `tools/simulator/artifacts/ai/standard-pack-pilot-champion-v6.json`
  - `tools/simulator/artifacts/ai/standard-pack-pilot-champion-v6.manifest.json`
  - `tools/simulator/reports/ai/standard-pack-evolution-pilot-v1.json`
  - `tools/simulator/docs/ai-standard-pack-evolution-pilot-v1.md`
  - `tools/simulator/reports/ai/standard-pack-evolution-pilot-v1-r1.json`
  - `tools/simulator/docs/ai-standard-pack-evolution-pilot-v1-r1.md`
- **本 R2 で新設された成果物**:
  - `tools/simulator/reports/ai/standard-pack-evolution-pilot-v1-r2.json`
  - `tools/simulator/docs/ai-standard-pack-evolution-pilot-v1-r2.md`
  - `tools/simulator/src/cli/standardPackEvolutionPilotRunnerR2.ts`
  - `tools/simulator/src/tests/ai/standardPackEvolutionPilotR2.test.ts`
- **最優秀候補 DNA (不変・完全保護)**:
  - Genome ID: `genome-sp-g0-004`
  - Full DNA Digest: `8623425d6ad29b2fc316e10f3ec4fd709dc81c5538fc9d9c62f69d3dfe7d6faa`
  - 総重み数: 23,738 重み
