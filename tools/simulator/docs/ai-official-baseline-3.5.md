# BlackPoker Simulator AI Self-Play Phase 3.5 公式ベースライン再計測レポート
## Official Light + Entry16 Baseline Re-measurement After Core Flow Repair

**作業ID:** `BP-SIM-AI-3.5-20260907-1750`  
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
1. **完走率 100.0% の達成 (600 / 600 Matches Complete)**:
   Phase 3.3では111件の未完走（完走率81.5%）が発生していましたが、新Baselineでは **600戦全数が正常に完走** しました（未完走 0件）。
2. **旧未完走111件の100%解決 (111 / 111 Complete)**:
   Diagnostics v1.1 に記録されていた旧111件の未完走ケースを正準キー（`pairId:legId:matchIndex`）で1対1照合した結果、**111件全数が新ベースライン上で正常終了**（勝敗決定）しました。旧未完走は平均76.9決定 / 6.4ターンで決着しています。
3. **完全な論理決定性 (Repeatability Gate PASS)**:
   同一条件での Run A（600戦）と Run B（600戦）において、Logical Payload（`e609a371...`）、Match Length 統計、Match Outcome Index の全要素が 100% 完全一致しました。
4. **試合長（Match Length）の健全性**:
   全600戦の平均決定数は **67.5決定**（中央値 71、最小 19、最大 89）、平均ターン数は **5.3ターン**（中央値 6、最小 1、最大 7）であり、打ち切り上限（500）より遥かに手前で正常に収束しています。
5. **ポリシー識別性（Policy Distinguishability）の結論**:
   - `FirstLegal`, `ZeroGenome`, `ManualGenericGenome` の3ポリシーは、完走率100%環境下でも **Counterfactual Agreement 100.0%**（意思決定が完全一致）を記録しました。
   - 勝率は、対 `SeededRandom` に対して 65.0% vs 35.0% であり、決定論的ポリシー同士では 50.0% vs 50.0% です。
   - **判定: 現時点で Fitness / Evolution 設計へ進むべきではない（STOP）**。Core Flow 修正により未完走ノイズは解消されましたが、現在の Feature Schema v1（Context 25 / Pattern 57）とタイブレーク順序の下では、Genome 重みによるポリシー分化が起きていないことが実証されました。

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

## 4. Completion & Match Outcome Before/After (完走率の劇的改善)

### 4.1 全体完走率比較

| 指標 | Phase 3.3 (v1) | Phase 3.5 (v2) | 差分 (Delta) |
| :--- | :---: | :---: | :---: |
| **Total Primary Matches** | 600 | 600 | 0 |
| **Completed Matches** | 489 | **600** | **+111** |
| **Incomplete Matches** | 111 | **0** | **-111** |
| **Completion Rate** | 81.5% | **100.0%** | **+18.5%** |
| **Setup Gap Matches** | 0 | 0 | 0 |
| **Technical Failures** | 0 | 0 | 0 |

### 4.2 旧未完走 111件の個別追跡結果

Diagnostics v1.1 にて Stage TOP 例外により未完走（500決定打ち切り）となっていた111件について、新ベースラインでの結果を正準キー（`pairId:legId:matchIndex`）で1対1追跡しました。

| 項目 | 追跡集計値 |
| :--- | :---: |
| **対象旧未完走件数** | 111 件 |
| **新ベースラインでの照合成功件数** | 111 件 (100%) |
| **未照合 (Unmatched) 件数** | 0 件 |
| **重複 (Duplicate) 件数** | 0 件 |
| **新ベースラインでの完走件数** | **111 件 (100.0%)** |
| **新ベースラインでの未完走件数** | **0 件 (0.0%)** |
| **決着決定数 (Decisions)** | 平均: 76.9, 中央値: 77, 最小: 42, 最大: 89 |
| **決着ターン数 (Turns)** | 平均: 6.4, 中央値: 7, 最小: 3, 最大: 7 |

---

## 5. Matchup Results & Delta (全6対戦カードの詳細比較)

各カード 100戦（Leg 1: 50, Leg 2: 50）の内訳です。

| Matchup (A vs B) | v1 Complete | v2 Complete | v1 A Wins (on Complete) | v2 A Wins | v1 B Wins | v2 B Wins | v1 A WinRate | v2 A WinRate | WinRate Delta |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **FirstLegal vs SeededRandom** | 87 | **100** (+13) | 57 | **65** | 30 | 35 | 65.5% | **65.0%** | -0.5% |
| **FirstLegal vs ZeroGenome** | 76 | **100** (+24) | 38 | **50** | 38 | 50 | 50.0% | **50.0%** | $\pm 0.0\%$ |
| **FirstLegal vs ManualGeneric** | 76 | **100** (+24) | 38 | **50** | 38 | 50 | 50.0% | **50.0%** | $\pm 0.0\%$ |
| **SeededRandom vs ZeroGenome** | 87 | **100** (+13) | 30 | 35 | 57 | **65** | 34.5% | **35.0%** | +0.5% |
| **SeededRandom vs ManualGeneric**| 87 | **100** (+13) | 30 | 35 | 57 | **65** | 34.5% | **35.0%** | +0.5% |
| **ZeroGenome vs ManualGeneric** | 76 | **100** (+24) | 38 | **50** | 38 | 50 | 50.0% | **50.0%** | $\pm 0.0\%$ |

---

## 6. Seat Bias (先攻・後攻の勝率比較)

| カード群 | P1 (先攻) Wins | P2 (後攻) Wins | P1 Win Rate | P2 Win Rate | 特徴 |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **vs SeededRandom (3カード・計300戦)** | 各カード 53勝 (計159勝) | 各カード 47勝 (計141勝) | **53.0%** | 47.0% | ランダム相手では先攻がわずかに有利（Phase 3.3の60.9%から適正化） |
| **Deterministic 同士 (3カード・計300戦)** | 各カード 48勝 (計144勝) | 各カード 52勝 (計156勝) | **48.0%** | **52.0%** | 後攻がわずかに勝ち越すもほぼ互角 |

---

## 7. Match Length (決定数およびターン数統計)

Phase 3.5 で導入された決定数およびターン数の詳細集計です。全600試合が完走しているため、`allMatches` と `completedMatches` は完全一致します。

| 集計範囲 | 試合数 | Decisions (平均 / 中央値 / 最小 / 最大) | Turns (平均 / 中央値 / 最小 / 最大) |
| :--- | :---: | :---: | :---: |
| **All Matches (全600戦)** | 600 | **67.5 / 71 / 19 / 89** | **5.3 / 6 / 1 / 7** |
| - FirstLegal vs SeededRandom | 100 | 48.9 / 54 / 19 / 81 | 3.9 / 4 / 1 / 7 |
| - FirstLegal vs ZeroGenome | 100 | 76.9 / 77 / 42 / 89 | 6.4 / 7 / 3 / 7 |
| - FirstLegal vs ManualGeneric | 100 | 76.9 / 77 / 42 / 89 | 6.4 / 7 / 3 / 7 |
| - SeededRandom vs ZeroGenome | 100 | 48.9 / 54 / 19 / 81 | 3.9 / 4 / 1 / 7 |
| - SeededRandom vs ManualGeneric | 100 | 48.9 / 54 / 19 / 81 | 3.9 / 4 / 1 / 7 |
| - ZeroGenome vs ManualGeneric | 100 | 76.9 / 77 / 42 / 89 | 6.4 / 7 / 3 / 7 |

> **考察**: 決定論的ポリシー同士の対戦（FirstLegal/Zero/Manual）は完全に同一の着手を行うため、決定数・ターン数の分布が3カード間で100%合同です。また、最長でも 89決定 / 7ターン で決着しており、500決定制限による打ち切りは一切発生していません。

---

## 8. Feature Diagnostics (特徴量診断比較)

### 8.1 Feature Coverage (特徴量の活性率)

| Feature Type | 総次元数 | v1 Active | v2 Active | Coverage Rate | 未活性特徴量数 |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Context Features** | 25 | 22 | **22** | **88.0%** | 3 |
| **Pattern Features** | 57 | 40 | **40** | **70.2%** | 17 |

未活性特徴量のセット（Context 3種、Pattern 17種）は Phase 3.3 と完全に同一であり、Light + Entry16 レギュレーションの仕様に合致しています。

### 8.2 Pattern Collision (合法手の衝突率)

| Participant | v1 Decisions | v1 Collision Rate | v2 Decisions | v2 Collision Rate | Max Group |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **FirstLegal** | 8,922 | 17.5% (1,563) | **10,726** | **17.6% (1,893)** | 24 |
| **ZeroGenome** | 8,922 | 17.5% (1,563) | **10,726** | **17.6% (1,893)** | 24 |
| **ManualGeneric** | 8,922 | 17.5% (1,563) | **10,726** | **17.6% (1,893)** | 24 |
| **SeededRandom** | 7,036 | 28.5% (2,005) | **8,331** | **28.5% (2,376)** | 24 |

完走率が向上したことにより観測された総意思決定数は増加しましたが、衝突率は約 17.6%（決定論的）/ 28.5%（ランダム）で安定しています。

### 8.3 Genome Argmax Ties (スコア同点率)

| Participant | v1 Tied Decisions | v1 Tie Rate | v2 Tied Decisions | v2 Tie Rate | Max Top Ties |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **ZeroGenome** | 2,919 / 8,922 | 32.7% | **3,516 / 10,726** | **32.8%** | 151 |
| **ManualGeneric** | 2,855 / 8,922 | 32.0% | **3,440 / 10,726** | **32.1%** | 150 |

### 8.4 Counterfactual Agreement (対向ポリシー選択一致率)

| 観測対象 Participant | FirstLegal との一致率 | ZeroGenome との一致率 |
| :--- | :---: | :---: |
| **FirstLegal** | **100.0%** | **100.0%** |
| **ZeroGenome** | **100.0%** | **100.0%** |
| **ManualGeneric** | **100.0%** | **100.0%** |
| **SeededRandom** | **70.6%** | **70.6%** |

---

## 9. 検討課題に対する回答 (Section 24 の11問)

### Q1. Core Flow修正後、Phase 3.3の111未完走は新600戦でどうなったか？
**回答:**  
111件すべてが新600戦内で特定され、**111件全数が正常に完走（100%解決）** しました。旧未完走ケースは平均76.9決定 / 6.4ターンで正常に勝敗が決しています。

### Q2. 新Baselineの完走率はいくつか？
**回答:**  
**100.0% (600 / 600 matches)** です。

### Q3. Phase 3.3と比較して勝率はどの程度変化したか？
**回答:**  
未完走が解消された後も、勝率傾向は極めて安定的です。
- `FirstLegal vs SeededRandom`: 65.5% $\rightarrow$ 65.0% (-0.5%)
- `SeededRandom vs ZeroGenome`: 34.5% $\rightarrow$ 35.0% (+0.5%)
- `SeededRandom vs ManualGeneric`: 34.5% $\rightarrow$ 35.0% (+0.5%)
- `FirstLegal / Zero / Manual` 相互間: 50.0% $\rightarrow$ 50.0% (不変)

### Q4. FirstLegal / Zero / Manualの同一傾向は続いているか？
**回答:**  
**はい、完全に続いています。**  
3者間での Counterfactual Agreement は依然として **100.0%** であり、10,726回の全意思決定において一度として異なる着手を選択していません。

### Q5. SeededRandomとの差はどう変わったか？
**回答:**  
SeededRandom相手の勝率は、決定論的3ポリシーすべてで約 65.0% を記録しており、ランダム着手に対する決定論的手順の優位性が明確に確認されています。

### Q6. Pattern Collisionは改善・悪化・不変のどれか？
**回答:**  
**不変** です（決定論的ポリシー: 17.5% $\rightarrow$ 17.6%、SeededRandom: 28.5% $\rightarrow$ 28.5%）。Feature Encoder v1 の構造が同一であるため、同一ベクトルに縮退する合法手グループの比率は変わりません。

### Q7. Argmax Tieはどう変わったか？
**回答:**  
**不変** です（Zero: 32.7% $\rightarrow$ 32.8%、Manual: 32.0% $\rightarrow$ 32.1%）。

### Q8. Feature coverageは変化したか？
**回答:**  
**不変** です（Context: 22/25 = 88.0%、Pattern: 40/57 = 70.2%）。

### Q9. Core Flowバグ修正によって、AI Policyの差を以前より観測しやすくなったか？
**回答:**  
**「未完走ノイズの完全排除」という意味では大幅に観測性が向上しました。**  
以前は「無限ループ・未完走」によってゲームが途中で強制終了していたため、Policyの性能差による決着なのかエンジンの不具合なのかが混濁していました。Phase 3.5 により、ゲームが100%ルール通りに完走したうえで、ポリシーの挙動を直接比較できるようになりました。

### Q10. 現時点でFitness設計へ進むだけのPolicy Distinguishabilityが得られたか？
**回答:**  
**「いいえ（得られていません）」**。  
全試合が完走した結果、`FirstLegal`, `ZeroGenome`, `ManualGenericGenome` の3者が **10,726回の意思決定で100%同じ着手を選んでいる** ことが純粋な形で証明されました。

### Q11. まだFitnessへ進むべきでない場合、その理由は何か？
**回答:**  
現在の Feature Schema v1（57次元）およびタイブレーク機構では、ゲノム重みを変化させてもスコアリング結果がタイブレーク順（最小 patternRef = 実質 FirstLegal）に吸収され、個体差が発現していません。  
この状態で Fitness / Evolution ループを回しても、**あらゆるゲノム個体が FirstLegal と同じ着手をとり、同一の勝率（65%対Random、50%対同類）を返すため、進化圧が全く機能しない（実質的な無駄打ちになる）** からです。  
したがって、次フェーズでは Fitness に入る前に、**「なぜゲノム重みが着手の分化を起こさないのか（Feature 表現力、重みスケーリング、タイブレークの改善）」** を解明・補修することが強く推奨されます。

---

## 10. 歴史的成果物の非破壊確認

以下の4成果物は一切変更されていないことを確認済みです：
1. `tools/simulator/reports/ai/official-light-entry16-baseline-v1.json` (Digest: `0f16b7d3f6193d58b016a5f5aeae9e5caef1c3faf5be2d5822027835c42ddaa4`)
2. `tools/simulator/reports/ai/official-light-entry16-diagnostics-v1.1.json` (Digest: `0ee51e74dc28ab761123f58ff2d58a26757bc85445ff43428e745bdd42cceb20`)
3. `tools/simulator/reports/coreflow/stage-top-cycle-case-m001-before-fix.json`
4. `tools/simulator/reports/coreflow/stage-top-cycle-case-m001-before-fix.txt`
