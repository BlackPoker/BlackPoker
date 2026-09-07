# BlackPoker Simulator AI Self-Play Phase 3.5 公式ベースライン再計測レポート
## Official Light + Entry16 Baseline Re-measurement After Core Flow Repair

**作業ID:** `BP-SIM-AI-3.5-20260907-1750` / `BP-SIM-AI-3.5.1-20260907-1905`  
**計測日時:** 2026-09-07 JST  
**対象リポジトリ:** `BlackPoker/BlackPoker`  
**対象ブランチ:** `BlackPoker/issue551-core-flow`  
**baseHead (基準HEAD):** `783aa852c009a3801f5cca623c794cdbabda916f`  
**coreFlowRepairHead:** `783aa852c009a3801f5cca623c794cdbabda916f`  
**measurementSourceHead (sourceHead):** `068f778852658288e7ffeb79eb0078334b513706`  
**新Baseline Artifact:** `tools/simulator/reports/ai/official-light-entry16-baseline-v2.json`  
**新Logical Digest:** `e609a3710ee3bcc23021d25b30209840fa542a7614f01ca5999208021948df0f`  
**Delta Artifact:** `tools/simulator/reports/ai/official-light-entry16-baseline-v1-v2-delta.json`  
**参照旧Baseline Artifact:** `tools/simulator/reports/ai/official-light-entry16-baseline-v1.json`  
**旧Logical Digest:** `0f16b7d3f6193d58b016a5f5aeae9e5caef1c3faf5be2d5822027835c42ddaa4`  
**参照旧Diagnostics Artifact:** `tools/simulator/reports/ai/official-light-entry16-diagnostics-v1.1.json`  
**旧Diagnostics Digest:** `0ee51e74dc28ab761123f58ff2d58a26757bc85445ff43428e745bdd42cceb20`  

---

## 1. エグゼクティブサマリー

Core Flow Phase 6.0系列（6.0, 6.0.1, 6.0.1.1, R1）によるStage TOP解決契約および不発解決契約の正常化を受け、Phase 3.3と完全に同一の実験構成（Official Light + Entry16, 4 Policies, 6 Matchups, Seat Swap, 計600戦, maxDecisions=500, baseSeed=20260906）にて、新公式ベースライン（Baseline v2）の再計測を実施しました。

### 【主要な測定結果ハイライト】
1. **計画 600 試合の全数完走 (600 / 600 Matches Complete)**:
   Official Light + Entry16 の今回の 600 計画試合では、INCOMPLETE / setup gap / technical failure なしで全試合が完走しました（Phase 3.3 では 111 件の未完走が発生、完走率 81.5%）。
2. **旧未完走 111 件の個別追跡完走 (111 / 111 Complete)**:
   Diagnostics v1.1 に記録されていた旧 111 件の未完走ケースを正準キー（`pairId:legId:matchIndex`）で 1 対 1 照合した結果、**111 件全数が新ベースライン上で正常終了**（勝敗決定）しました。旧未完走は平均 70.49 決定（中央値 71、最小 42、最大 89）/ 平均 5.65 ターン（中央値 6、最小 2、最大 7）で決着しています。
3. **完全な論理決定性 (Repeatability Gate PASS)**:
   同一条件での Run A（600 戦）と Run B（600 戦）において、Logical Payload（`e609a371...`）、Match Length 統計、Match Outcome Index の全要素が 100% 完全一致しました。
4. **試合長（Match Length）の統計**:
   全 600 戦の平均決定数は **67.515 決定**（中央値 71、最小 19、最大 89）、平均ターン数は **5.305 ターン**（中央値 6、最小 1、最大 7）であり、打ち切り上限（500）より遥かに手前で正常に収束しています。
5. **ポリシー識別性（Policy Distinguishability）の結論**:
   - 今回テストした 2 つのゲノムポリシー `ZeroGenome` と `ManualGenericGenome` は、観測 trajectory 上で `FirstLegal` と **Counterfactual Agreement 100.0%**（意思決定が完全一致）を記録しました。
   - 一方、`SeededRandom` の対向一致率は Phase 3.3 の 86.67% から **70.58%** へ低下し、ランダムとの差異はより明確になりました。
   - **判定: 現時点で Fitness / Evolution 設計へ進むべきではない（保留）**。ただし理由は「あらゆるゲノム個体が無意味」だからではなく、「現在テスト済みの 2 ゲノム（Zero / ManualGeneric）だけでは Policy Distinguishability が確認できず、任意 DNA に対する Scorer 感度が未検証であるため」です。次候補作業として **Genome Sensitivity / Policy Separability Probe** を提案します。

---

## 2. 実験構成と条件（Phase 3.3との完全一致性）

Phase 3.3 との因果的比較可能性を担保するため、以下の構成・パラメータは一切変更せず厳密に再利用しました。

- **Regulation**: `light-entry16`
- **Format**: `light`
- **Frame**: `entry16`
- **Rules Version**: `rules-vnext-9.1.2`
- **Participants (4 Policies)**:
  1. `FirstLegal` (`baseline-first-legal-v1`)
  2. `SeededRandom` (`baseline-seeded-random-v1`)
  3. `ZeroGenome` (`baseline-zero-genome-v1`)
  4. `ManualGenericGenome` (`baseline-manual-generic-v1`)
- **Pairings**: 4 Participant の全カード $C(4, 2) = 6$ Pairings
- **Seat Swap**: 各カード 50 matches/seat $\times$ 2 seats = 100 matches（計 600 primary matches）
- **Seed 計画**: `baseSeed = 20260906`, `matchIndex = 0..49`（`BatchSimulationRunner.planMatch` による決定論的導出）
- **Max Decisions**: 500
- **Feature Encoder**: Context 25次元 / Pattern 57次元 (Schema v1.0.0)
- **タイブレーク規則**: 最小 `patternRef`

---

## 3. Setup Viability Audit (100 Seeds 監査結果)

| 項目 | Phase 3.3 (v1) | Phase 3.5 (v2) | Delta | 備考 |
| :--- | :---: | :---: | :---: | :--- |
| **Planned Setups** | 100 | 100 | 0 | `baseSeed: 20260906`, index 0〜99 |
| **READY Setups** | 100 | 100 | 0 | 全シードで正常開始 |
| **TERMINAL Setups** | 0 | 0 | 0 | セットアップ時ライフ枯渇なし |
| **RULE_UNSPECIFIED Setups** | 0 | 0 | 0 | 先攻決定/ドロー枯渇なし |

---

## 4. Completion & Match Outcome Before/After (完走結果)

### 4.1 全体完走比較

| 指標 | Phase 3.3 (v1) | Phase 3.5 (v2) | 差分 (Delta) |
| :--- | :---: | :---: | :---: |
| **Total Primary Matches** | 600 | 600 | 0 |
| **Completed Matches** | 489 | **600** | **+111** |
| **Incomplete Matches** | 111 | **0** | **-111** |
| **Completion Rate** | 81.5% | **100.0%** | **+18.5%** |
| **Setup Gap Matches** | 0 | 0 | 0 |
| **Technical Failures** | 0 | 0 | 0 |

### 4.2 旧未完走 111件の個別追跡結果

Diagnostics v1.1 にて Stage TOP 例外により未完走（500決定打ち切り）となっていた 111 件について、新ベースラインでの結果を正準キー（`pairId:legId:matchIndex`）で 1 対 1 追跡した正確な統計値です。

| 項目 | 追跡集計値 |
| :--- | :---: |
| **対象旧未完走件数** | 111 件 |
| **新ベースラインでの照合成功件数** | 111 件 (100.0%) |
| **未照合 (Unmatched) 件数** | 0 件 |
| **重複 (Duplicate) 件数** | 0 件 |
| **新ベースラインでの完走件数** | **111 件 (100.0%)** |
| **新ベースラインでの未完走件数** | **0 件 (0.0%)** |
| **決着決定数 (Decisions)** | 平均: **70.486** (70.49), 中央値: **71**, 最小: **42**, 最大: **89** |
| **決着ターン数 (Turns)** | 平均: **5.649** (5.65), 中央値: **6**, 最小: **2**, 最大: **7** |

---

## 5. Matchup Results & Delta (全6対戦カードの詳細比較)

各カード 100 戦（Leg 1: 50, Leg 2: 50）の内訳です。

| Matchup (A vs B) | v1 Complete | v2 Complete | v1 A Wins (on Complete) | v2 A Wins | v1 B Wins | v2 B Wins | v1 A WinRate | v2 A WinRate | WinRate Delta |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **FirstLegal vs SeededRandom** | 87 | **100** (+13) | 57 | **65** | 30 | 35 | 65.52% | **65.00%** | -0.52% |
| **FirstLegal vs ZeroGenome** | 76 | **100** (+24) | 38 | **50** | 38 | 50 | 50.00% | **50.00%** | $\pm 0.00\%$ |
| **FirstLegal vs ManualGeneric** | 76 | **100** (+24) | 38 | **50** | 38 | 50 | 50.00% | **50.00%** | $\pm 0.00\%$ |
| **SeededRandom vs ZeroGenome** | 87 | **100** (+13) | 30 | 35 | 57 | **65** | 34.48% | **35.00%** | +0.52% |
| **SeededRandom vs ManualGeneric**| 87 | **100** (+13) | 30 | 35 | 57 | **65** | 34.48% | **35.00%** | +0.52% |
| **ZeroGenome vs ManualGeneric** | 76 | **100** (+24) | 38 | **50** | 38 | 50 | 50.00% | **50.00%** | $\pm 0.00\%$ |

---

## 6. Seat Bias (先攻・後攻の勝率比較)

| カード群 | P1 (先攻) Wins | P2 (後攻) Wins | P1 Win Rate | P2 Win Rate | 特徴 |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **vs SeededRandom (3カード・計300戦)** | 各カード 53勝 (計159勝) | 各カード 47勝 (計141勝) | **53.0%** | 47.0% | ランダム相手では先攻がわずかに有利（Phase 3.3の60.9%から適正化） |
| **Deterministic 同士 (3カード・計300戦)** | 各カード 48勝 (計144勝) | 各カード 52勝 (計156勝) | **48.0%** | **52.0%** | 後攻がわずかに勝ち越すもほぼ互角 |

---

## 7. Match Length (決定数およびターン数統計)

全 600 試合が完走しているため、`allMatches` と `completedMatches` は完全一致します。各カードごとの実測値は以下の通りです。

| 集計範囲 | 試合数 | Decisions (平均 / 中央値 / 最小 / 最大) | Turns (平均 / 中央値 / 最小 / 最大) |
| :--- | :---: | :---: | :---: |
| **All Matches (全600戦)** | 600 | **67.515 / 71 / 19 / 89** | **5.305 / 6 / 1 / 7** |
| **Randomを含む各カード (計300戦)** | | | |
| - FirstLegal vs SeededRandom | 100 | **56.19 / 56 / 19 / 89** | **4.05 / 4 / 1 / 7** |
| - SeededRandom vs ZeroGenome | 100 | **56.19 / 56 / 19 / 89** | **4.05 / 4 / 1 / 7** |
| - SeededRandom vs ManualGeneric | 100 | **56.19 / 56 / 19 / 89** | **4.05 / 4 / 1 / 7** |
| **Deterministic同士の各カード (計300戦)** | | | |
| - FirstLegal vs ZeroGenome | 100 | **78.84 / 83 / 48 / 89** | **6.56 / 7 / 4 / 7** |
| - FirstLegal vs ManualGeneric | 100 | **78.84 / 83 / 48 / 89** | **6.56 / 7 / 4 / 7** |
| - ZeroGenome vs ManualGeneric | 100 | **78.84 / 83 / 48 / 89** | **6.56 / 7 / 4 / 7** |

> **考察**:  
> - `SeededRandom` を含む 3 カードでは、ランダム手による早期決着（最短 19 決定 / 1 ターン）が含まれるため、平均決定数は **56.19**（中央値 56）、平均ターン数は **4.05**（中央値 4）となります。  
> - 一方、決定論的 3 者（FirstLegal / Zero / Manual）同士の対戦では着手が 100% 同一であるため、3 カードの分布が完全に合同（平均 **78.84** 決定、中央値 83、最小 48、最大 89 / 平均 **6.56** ターン、中央値 7、最小 4、最大 7）となります。最長でも 89 決定 / 7 ターンで決着しており、500 決定による打ち切りは皆無です。

---

## 8. Feature Diagnostics (特徴量診断比較)

### 8.1 Feature Coverage (特徴量の活性率)

| Feature Type | 総次元数 | v1 Active | v2 Active | Coverage Rate | 未活性特徴量数 |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Context Features** | 25 | 22 | **22** | **88.0%** | 3 |
| **Pattern Features** | 57 | 40 | **40** | **70.2%** | 17 |

未活性特徴量のセット（Context 3種、Pattern 17種）は Phase 3.3 と完全に同一であり、Light + Entry16 レギュレーションの仕様に合致しています。

### 8.2 Pattern Collision (合法手の衝突率)

| Participant | v1 Decisions (母集団) | v1 衝突率 (件数) | v2 Decisions (母集団) | v2 衝突率 (件数) | 変化の解釈 |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **FirstLegal** | 23,683 | **7.2457%** (1,716) | **10,726** | **17.6487%** (1,893) | 母集団変化に伴う上昇 |
| **ZeroGenome** | 23,683 | **7.2457%** (1,716) | **10,726** | **17.6487%** (1,893) | 母集団変化に伴う上昇 |
| **ManualGeneric** | 23,683 | **7.2457%** (1,716) | **10,726** | **17.6487%** (1,893) | 母集団変化に伴う上昇 |
| **SeededRandom** | 16,839 | **12.8630%** (2,166) | **8,331** | **28.5200%** (2,376) | 母集団変化に伴う上昇 |

> **重要分析 (母集団変化の因果関係)**:  
> 衝突率は v1 の約 7.25%（決定論）/ 12.86%（ランダム）から、v2 では **17.65%**（決定論）/ **28.52%**（ランダム）へと数値上上昇しています。  
> これは Feature 設計が悪化したわけではなく、**Core Flow 修正によって Decision trajectory の母集団構造が根本的に正常化したため** です。  
> - Phase 3.3 では 111 試合が Stage TOP 例外により 500 決定まで空転ループしており、その単調なループ区間（合法手が少なく衝突が起きない局面）が分母（23,683 / 16,839）を大幅に水増ししていました。  
> - Phase 3.5 では未完走ループが 0 件となり、総決定数が正常な 10,726 / 8,331 件へと適正化した結果、多対多の戦闘・ブロック局面が意思決定全体に占める割合が純粋に観測されたことによります。

### 8.3 Genome Argmax Ties (スコア同点率)

| Participant | v1 観測意思決定 | v1 同点率 (件数) | v2 観測意思決定 | v2 同点率 (件数) | Max Top Ties |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **ZeroGenome** | 23,683 | **12.8911%** (3,053) | **10,726** | **32.7802%** (3,516) | 151 |
| **ManualGeneric** | 23,683 | **12.6335%** (2,992) | **10,726** | **32.0716%** (3,440) | 150 |

> **分析**:  
> 同点率も同様に、v1 の約 12.8% から v2 の約 **32.8%**（Zero）/ **32.1%**（Manual）へと変化しています。これも未完走ループの除外により、複雑な選択肢が生じる盤面が本来の割合で集計されたことによるものです。

### 8.4 Counterfactual Agreement (対向ポリシー選択一致率)

| 観測対象 Participant | v1 一致率 (vs FirstLegal / vs Zero) | v2 一致率 (vs FirstLegal / vs Zero) | 変化 |
| :--- | :---: | :---: | :--- |
| **FirstLegal** | 100.0000% / 100.0000% | **100.0000% / 100.0000%** | 不変 (完全一致) |
| **ZeroGenome** | 100.0000% / 100.0000% | **100.0000% / 100.0000%** | 不変 (完全一致) |
| **ManualGeneric** | 100.0000% / 100.0000% | **100.0000% / 100.0000%** | 不変 (完全一致) |
| **SeededRandom** | 86.6738% / 86.6738% | **70.5798% / 70.5798%** | **-16.0940%** (差異が明確化) |

> **分析**:  
> `FirstLegal`, `ZeroGenome`, `ManualGenericGenome` の 3 者間は、正常な全 10,726 回の意思決定においても **100.0% 完全一致** を維持しました。  
> 一方、`SeededRandom` は v1 の 86.67% から **70.58%** へと一致率が低下しました。ループによる FirstLegal 追随の擬似的な一致が排除され、ランダム着手と決定論的手法との真の行動差が明瞭に観測されています。

---

## 9. 検討課題に対する回答 (Section 24 の11問)

### Q1. Core Flow修正後、Phase 3.3の111未完走は新600戦でどうなったか？
**回答:**  
111 件すべてが新 600 戦内で特定され、**111 件全数が正常に完走（100% 解決）** しました。旧未完走ケースは平均 **70.49** 決定（中央値 71、最小 42、最大 89）/ 平均 **5.65** ターン（中央値 6、最小 2、最大 7）で正常に勝敗が決しています。

### Q2. 新Baselineの完走率はいくつか？
**回答:**  
**100.0% (600 / 600 matches)** です。Official Light + Entry16 の今回の 600 計画試合では、INCOMPLETE / setup gap / technical failure なしで全試合が完走しました。

### Q3. Phase 3.3と比較して勝率はどの程度変化したか？
**回答:**  
未完走が解消された後も、勝率傾向は極めて安定的です。
- `FirstLegal vs SeededRandom`: 65.52% $\rightarrow$ **65.00%** (-0.52%)
- `SeededRandom vs ZeroGenome`: 34.48% $\rightarrow$ **35.00%** (+0.52%)
- `SeededRandom vs ManualGeneric`: 34.48% $\rightarrow$ **35.00%** (+0.52%)
- `FirstLegal / Zero / Manual` 相互間: 50.00% $\rightarrow$ **50.00%** (完全同率)

### Q4. FirstLegal / Zero / Manualの同一傾向は続いているか？
**回答:**  
**はい、テストされた 2 ゲノムにおいて完全に続いています。**  
`FirstLegal`, `ZeroGenome`, `ManualGenericGenome` の 3 者間での Counterfactual Agreement は依然として **100.0%** であり、10,726 回の全意思決定において一度として異なる着手を選択していません。

### Q5. SeededRandomとの差はどう変わったか？
**回答:**  
対 SeededRandom の勝率は約 65.0% で安定しており、Counterfactual 一致率は 86.67% から **70.58%** に低下したことで、ランダムと決定論的手法との行動差がより明瞭に観測できるようになりました。

### Q6. Pattern Collisionは改善・悪化・不変のどれか？
**回答:**  
**母集団の変化により数値が 7.25% $\rightarrow$ 17.65%（決定論）/ 12.86% $\rightarrow$ 28.52%（ランダム）へ上昇しました。**  
これは Feature Encoder の性能悪化ではなく、v1 で分母を水増ししていた単調な未完走ループ区間が排除され、正常な複雑局面の比率が純粋に反映されたためです。

### Q7. Argmax Tieはどう変わったか？
**回答:**  
**同様に母集団変化により数値が約 12.8% $\rightarrow$ 約 32.8%（Zero）/ 約 32.1%（Manual）へ上昇しました。**  
同点となる選択肢を含む戦闘局面が本来の割合で観測されています。

### Q8. Feature coverageは変化したか？
**回答:**  
**不変** です（Context: 22/25 = 88.0%、Pattern: 40/57 = 70.2%）。未活性特徴量セットも完全に同一です。

### Q9. Core Flowバグ修正によって、AI Policyの差を以前より観測しやすくなったか？
**回答:**  
**未完走ノイズ（Stage TOP 例外・500回打ち切り）が 100% 排除されたため、ゲームエンジンとしての健全な観測基盤が完成しました。**  
エンジンの不具合による途中終了とポリシーの性能差が混濁することがなくなり、健全な終局盤面での行動差を正確に追跡できるようになりました。

### Q10. 現時点でFitness設計へ進むだけのPolicy Distinguishabilityが得られたか？
**回答:**  
**「いいえ（得られていません）」**。  
全試合が完走した結果、テストされた 2 つのゲノムポリシー（ZeroGenome / ManualGenericGenome）が観測 trajectory 上で FirstLegal と 100% 一致することが明確に示されました。

### Q11. まだFitnessへ進むべきでない場合、その理由は何か？
**回答:**  
**現在テスト済みの 2 つのゲノム（Zero / ManualGeneric）だけでは Policy Distinguishability が確認できておらず、任意 DNA に対する Scorer 感度がまだ未検証であるためです。**  
（※「あらゆるゲノム個体が FirstLegal と同じ」と過剰一般化するのではなく、テストされた手動重み付け程度ではタイブレーク順を覆すだけのスコア差が生じないことが判明した状態です）。  
したがって、直ちに Fitness / Evolution ループへ進むのではなく、次候補作業として **Genome Sensitivity / Policy Separability Probe**（多様なランダムゲノムや極端な重みを持つゲノムを与えたときに、着手分化がどの程度起きるかを事前にプローブ検証するタスク）を実施することを提案します。

---

## 10. 歴史的成果物の非破壊確認

以下の 4 成果物は一切変更されていないことを確認済みです：
1. `tools/simulator/reports/ai/official-light-entry16-baseline-v1.json` (Digest: `0f16b7d3f6193d58b016a5f5aeae9e5caef1c3faf5be2d5822027835c42ddaa4`)
2. `tools/simulator/reports/ai/official-light-entry16-diagnostics-v1.1.json` (Digest: `0ee51e74dc28ab761123f58ff2d58a26757bc85445ff43428e745bdd42cceb20`)
3. `tools/simulator/reports/coreflow/stage-top-cycle-case-m001-before-fix.json`
4. `tools/simulator/reports/coreflow/stage-top-cycle-case-m001-before-fix.txt`
