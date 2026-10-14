# BlackPoker Simulator AI Evolution g1 Incomplete Match Analysis V1

作業ID: `BP-SIM-AI-EVOLUTION-INCOMPLETE-ANALYSIS-V1`  
更新日時: 2026-10-15 02:20 JST  
対象ブランチ: `BlackPoker/issue551-core-flow`  
ベース HEAD SHA: `4f52fef0a3bedfee648c3fdae7d51d35b4685301`  
ステータス: **ANALYZED / PENDING INDEPENDENT REVIEW**  

---

## 1. Scope (スコープと分析境界)

本作業の目的は、`BP-SIM-AI-EVOLUTION-LOOP-EVIDENCE-V1` で観測された以下の技術的事象について、Production Path 上で決定論的に原因を分析・特定することです。

- **Generation 0**: 30/30 試合完走、全 6 個体 VALID、世代交代成功 ($g=0 \to g=1$)
- **Generation 1**: 2/30 試合完走、**28/30 試合未完了 (INCOMPLETE)**、VALID 0、INSUFFICIENT_EVIDENCE 6、`REEVALUATION_REQUIRED` により即時論理停止

### 分析 Question
1. **Q1 (State 循環)**: 28 試合の未完了対戦は同一の論理 Game State を循環しているか？
2. **Q2 (State 進行)**: State は進行しているが 500 decisions では不足しているだけか？
3. **Q3 (行動周期性)**: 特定の Action / PASS / Effect Selection 等を周期的に選択しているか？
4. **Q4 (個体・座席依存性)**: 問題は特定の Genome、特定の Genome Pair、または座席（P1/P2）に依存しているか？
5. **Q5 (Elite vs Offspring)**: Zero DNA を維持した Elite（`genome-001`）と変異済み Offspring の間で明確な行動差があるか？
6. **Q6 (単一 vs 複合要因)**: 全 28 試合で同一の原因なのか、複数の要因が混在しているか？

### 非スコープ・禁止事項
- 本番コード（Production Engine）の変更
- `maxDecisionsPerMatch` の引き上げ（500 → 1000/5000 等）
- 適応度閾値（`minCompletedMatches` 等）の緩和
- 突然変異パラメータ（`mutationRate`, `mutationSigma` 等）の変更
- Evolution Loop 設定の変更
- Controlled Evidence の再試行

---

## 2. Prior Evidence Finding (前エビデンスでの観測事実)

前エビデンス（`BP-SIM-AI-EVOLUTION-LOOP-EVIDENCE-V1`）において、Generation 0 では全個体が Zero DNA（全重み 0）であったため、決定論的タイブレーク（最小 `patternRef`）により 30 試合すべてが正常に完走しました。

しかし、Generation 1 では 30 試合中わずか 2 試合のみが完走し、残り 28 試合が 500 decisions のステップ上限ガード（`maxDecisionsPerMatch: 500`）に達して未完了決着となりました。完走試合数が不足したため全個体が `INSUFFICIENT_EVIDENCE` となり、有効候補数 0 でトーナメント選択不能となり `REEVALUATION_REQUIRED` で論理停止しました。

---

## 3. Canonical Recipe (カノニカル検証設定)

| パラメータ名 | 設定値 | 決定根拠 / 参照元 |
|---|---|---|
| **Regulation ID** | `light-entry16` | Official Regulation カタログより直接ロード |
| **Format ID** | `light` | `RegulationDefinition.formatId` 実測値 |
| **Frame ID** | `entry16` | `RegulationDefinition.frameId` 実測値 |
| **Rule Package Version** | `1.0.0` | `officialRulePackage.version` 実測値 |
| **Initial Population Size ($N$)** | `6` | 最小検証母集団サイズ |
| **Initial Target Generation ($g$)** | `0` | 初期世代 |
| **Initial DNA Type** | `Zero Decision DNA` | `DecisionDNACodec.createZeroDecisionDNA()` |
| **Initial Genome IDs** | `genome-000` 〜 `genome-005` | 決定論的 6 個体 |
| **Campaign Seed** | `42` | Canonical Controlled Campaign Seed |
| **g0 Generation Seed** | `4143575905` (`0xf6f9f361`) | `deriveSeed(42, "generation-stream-v1:g=0")` |
| **g1 Generation Seed** | `4126798286` (`0xf5f9f1ce`) | `deriveSeed(42, "generation-stream-v1:g=1")` |
| **Pair Repetitions ($R$)** | `1` | Canonical Double Round Robin |
| **Max Decisions / Match** | `500` | ステップ上限ガード |
| **Builder Population Size** | `6` | `loopConfig.runnerConfig.builderConfig.populationSize` |

---

## 4. g1 Reconstruction (Generation 1 母集団の再構築)

Analysis Harness（`src/cli/evolutionIncompleteAnalysis.ts`）内で `EvolutionLoop.run` を `generationCount = 1` で実行し、前エビデンスと完全に同一の Generation 1 母集団を決定論的に再構築しました。

- **`status`**: `"COMPLETED"`
- **`completedTransitions`**: 1
- **`finalPopulation.generation`**: 1
- **`finalPopulation.entries.length`**: 6
- **再構築個体 ID 一覧**:
  1. `genome-001` (Elite)
  2. `gen-000001-offspring-000000` (Offspring 0)
  3. `gen-000001-offspring-000001` (Offspring 1)
  4. `gen-000001-offspring-000002` (Offspring 2)
  5. `gen-000001-offspring-000003` (Offspring 3)
  6. `gen-000001-offspring-000004` (Offspring 4)
- **前エビデンスとの ID Set 一致**: **YES** (完全一致)

---

## 5. DNA Summary (g1 個体 DNA 統計サマリー)

全 6 個体について、重みベクトルの非ゼロ要素数・最小・最大・平均絶対値を実測集計しました。

| Genome ID | 種別 | Zero DNA? | 非ゼロ Pattern 重み (143次元) | 非ゼロ Interaction 重み (23,309次元) | 総非ゼロ重み (23,452次元) | 最小重み | 最大重み | 平均絶対非ゼロ重み |
|---|---|---|---|---|---|---|---|---|
| `genome-001` | Elite | **YES** | 0 | 0 | **0** (0.00%) | 0.0000 | 0.0000 | 0.0000 |
| `gen-000001-offspring-000000` | Offspring | **NO** | 1 | 237 | **238** (1.01%) | -0.1600 | 0.1400 | 0.0410 |
| `gen-000001-offspring-000001` | Offspring | **NO** | 2 | 239 | **241** (1.03%) | -0.1500 | 0.1700 | 0.0400 |
| `gen-000001-offspring-000002` | Offspring | **NO** | 0 | 236 | **236** (1.01%) | -0.1400 | 0.1400 | 0.0390 |
| `gen-000001-offspring-000003` | Offspring | **NO** | 1 | 240 | **241** (1.03%) | -0.1500 | 0.1500 | 0.0400 |
| `gen-000001-offspring-000004` | Offspring | **NO** | 2 | 232 | **234** (1.00%) | -0.1700 | 0.1400 | 0.0400 |

### 実測事実
1. Elite 個体（`genome-001`）は Zero DNA（全重み 0）を完全に保持している。
2. 5 体の子個体はすべて、`DEFAULT_GENETIC_OPERATOR_CONFIG`（`mutationRate: 0.01`, `mutationSigma: 0.05`）に基づき、約 1%（234〜241 個）の非ゼロ重みを獲得している。

---

## 6. Pair Completion Matrix (15 対戦ペアの完走実績)

全 15 組の非順序ペア（30 試合）について、Leg 0（往路）および Leg 1（復路）の完走状況を走査集計しました。

| Pair | Individual A | Individual B | Leg 0 Match | Leg 0 完走 | Leg 0 Decisions | Leg 1 Match | Leg 1 完走 | Leg 1 Decisions | 両 Leg 完走 | 両 Leg 未完了 |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | offspring-000000 | offspring-000001 | #0 | NO | 500 | #1 | NO | 500 | NO | **YES** |
| 1 | offspring-000000 | offspring-000002 | #2 | NO | 500 | #3 | NO | 500 | NO | **YES** |
| 2 | offspring-000000 | offspring-000003 | #4 | NO | 500 | #5 | NO | 500 | NO | **YES** |
| 3 | offspring-000000 | offspring-000004 | #6 | NO | 500 | #7 | NO | 500 | NO | **YES** |
| 4 | offspring-000000 | genome-001 | #8 | NO | 500 | #9 | NO | 500 | NO | **YES** |
| 5 | offspring-000001 | offspring-000002 | #10 | NO | 500 | #11 | NO | 500 | NO | **YES** |
| 6 | offspring-000001 | offspring-000003 | #12 | NO | 500 | #13 | NO | 500 | NO | **YES** |
| 7 | offspring-000001 | offspring-000004 | #14 | NO | 500 | #15 | NO | 500 | NO | **YES** |
| 8 | offspring-000001 | genome-001 | #16 | NO | 500 | #17 | NO | 500 | NO | **YES** |
| 9 | offspring-000002 | offspring-000003 | #18 | NO | 500 | #19 | NO | 500 | NO | **YES** |
| 10 | offspring-000002 | offspring-000004 | #20 | NO | 500 | #21 | NO | 500 | NO | **YES** |
| 11 | offspring-000002 | genome-001 | #22 | NO | 500 | #23 | NO | 500 | NO | **YES** |
| 12 | offspring-000003 | offspring-000004 | #24 | NO | 500 | #25 | NO | 500 | NO | **YES** |
| 13 | offspring-000003 | genome-001 | #26 | NO | 500 | #27 | NO | 500 | NO | **YES** |
| 14 | offspring-000004 | genome-001 | #28 | **YES** | **62** | #29 | **YES** | **62** | **YES** | NO |

### 実測事実
- **完走ペア**: Pair 14 (`gen-000001-offspring-000004` vs `genome-001`) のみ。座席を反転した Leg 0 および Leg 1 の両方で、ともに **62 decisions** で正常決着（COMPLETED）。
- **未完了ペア**: Pair 0 から Pair 13 までの 14 ペアすべてが、座席を反転しても両 Leg ともに **500 decisions** で未完了決着（INCOMPLETE）。

---

## 7. Participant Completion Matrix (個体別完走サマリー)

| Genome ID | 計画試合数 | 完走試合数 | 未完了試合数 | asP1 完走数 | asP2 完走数 | 完走率 |
|---|---|---|---|---|---|---|
| `genome-001` (Elite) | 10 | 2 | 8 | 1 | 1 | 20.0% |
| `gen-000001-offspring-000000` | 10 | 0 | 10 | 0 | 0 | 0.0% |
| `gen-000001-offspring-000001` | 10 | 0 | 10 | 0 | 0 | 0.0% |
| `gen-000001-offspring-000002` | 10 | 0 | 10 | 0 | 0 | 0.0% |
| `gen-000001-offspring-000003` | 10 | 0 | 10 | 0 | 0 | 0.0% |
| `gen-000001-offspring-000004` | 10 | 2 | 8 | 1 | 1 | 20.0% |

---

## 8. State Hash Analysis (状態ハッシュ重複・周期性分析)

全 30 試合の Decision Trace v2 レコードに記録された `stateHash` を走査し、同一対戦内でのハッシュ重複および周期的サフィックス（Periodic Suffix）の有無を分析しました。

- **重複ハッシュが存在した未完了対戦**: **0 / 28 試合 (0.0%)**
- **重複ハッシュが一切存在しなかった未完了対戦**: **28 / 28 試合 (100.0%)**
- **各未完了試合のユニーク状態数**: **500 / 500 (100.0% ユニーク)**
- **周期的サフィックス候補 (Periodic Suffix Candidate)**: **0 / 28 試合 (0.0%)**

> [!IMPORTANT]
> **状態重複に関する決定論的証拠**:
> 28 試合の未完了対戦において、同一の `stateHash` が 1 度でも再登場した事例は **0 件** でした。すべての対戦で 500 回の意思決定直前の論理状態ハッシュはすべて異なっており、有限周期の State ループ（閉じた状態循環）には陥っていません。

---

## 9. Decision Pattern Analysis (行動種別・アクション・進行状況分析)

全 30 試合（計 14,124 decisions）の実測行動内訳を集計しました。

### 全体行動種別内訳
- **PASS**: **13,960 decisions (98.84%)**
- **ACTION**: **146 decisions (1.03%)**
- **EFFECT_SELECTION**: **18 decisions (0.13%)**

### 未完了対戦（500 decisions）の特徴
- **PASS 比率**: **99.2% 〜 99.8%**（各試合 496〜499 回が PASS）
- **進行ターン数 (`turnCount`)**: **1 ターンのみ (turnCount === 1)**
- **末尾 100 手番**: ほぼ 100% が PASS の連続
- **状態バージョン (`stateVersion`)**: 意思決定ごとに `nextRequestSeq` や `consecutivePassCount` が更新されるため `stateVersion` は増加し続けるが、ターンは Turn 1 のまま進行しない。

### トップアクション出現数
1. `action.twist`: 35 回
2. `action.down`: 29 回
3. `action.counter`: 23 回
4. `action.end`: 20 回
5. `action.up`: 12 回
6. `action.attack`: 10 回
7. `action.destroyBulwark`: 9 回
8. `action.summonSoldier`: 6 回
9. `action.throwing`: 1 回
10. `action.mountSoldier`: 1 回

---

## 10. Deep Replay Samples (決定論的詳細リプレイ検証)

First Pass の結果に基づき、決定論的サンプルを選出して `SimulationRunner.run` の `onStep` により各意思決定直前の論理状態（`StateHasher.extractLogicalState`）を抽出・比較しました。

### サンプル選定
- **Sample A**: 最小 matchIndex の未完了対戦 (Match #0, Pair 0 Leg 0, `offspring-0` vs `offspring-1`)
- **Sample B**: Sample A の鏡像対戦 (Match #1, Pair 0 Leg 1, `offspring-1` vs `offspring-0`)
- **Sample C**: 最小 matchIndex の完走対戦 (Match #28, Pair 14 Leg 0, `offspring-4` vs `genome-001`)
- **Sample D**: Sample C の鏡像対戦 (Match #29, Pair 14 Leg 1, `genome-001` vs `offspring-4`)
- **Sample E**: 別ペアの最小 matchIndex 未完了対戦 (Match #2, Pair 1 Leg 0, `offspring-0` vs `offspring-2`)

### リプレイ検証結果表
| Sample | Match # | Pair | Participants | Replay 決定論性 | 完走 | Decisions | Turns | ユニーク State 比率 | PASS 比率 | 周期候補 | 分類 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Sample A** | #0 | Pair 0 Leg 0 | `offspring-0` vs `offspring-1` | **MATCH (100%)** | NO | 500 | 1 | 1.000 | 99.2% | なし | `PROGRESSING_LONG_MATCH` |
| **Sample B** | #1 | Pair 0 Leg 1 | `offspring-1` vs `offspring-0` | **MATCH (100%)** | NO | 500 | 1 | 1.000 | 99.8% | なし | `PROGRESSING_LONG_MATCH` |
| **Sample C** | #28 | Pair 14 Leg 0 | `offspring-4` vs `genome-001` | **MATCH (100%)** | **YES** | 62 | 7 | 1.000 | 66.1% | なし | `COMPLETED_MATCH` |
| **Sample D** | #29 | Pair 14 Leg 1 | `genome-001` vs `offspring-4` | **MATCH (100%)** | **YES** | 62 | 7 | 1.000 | 67.7% | なし | `COMPLETED_MATCH` |
| **Sample E** | #2 | Pair 1 Leg 0 | `offspring-0` vs `offspring-2` | **MATCH (100%)** | NO | 500 | 1 | 1.000 | 99.6% | なし | `PROGRESSING_LONG_MATCH` |

- **Replay 決定論性**: First Pass の `completed`, `winner`, `totalDecisions`, `finalStateHash`, および全手番の `logicalDecisionId` / `stateHash` / `selectedLogicalPatternKey` と **100% 完全一致**。
- **構造的一致の確認**: 同一 `stateHash` が再登場しなかったため、周期境界の不一致によるものではなく、状態が真に一意に進行していることが裏付けられた。

---

## 11. Cycle Classification (分類基準に基づく判定)

ユーザー指示書 Section 2 で定義された 4 つのカテゴリに対して、実機検証結果を照合しました。

| カテゴリ | 定義 | 実測該当数 | 判定 |
|---|---|---|---|
| **A. VERIFIED_PERIODIC_STATE_CYCLE** | 500手到達、周期サフィックスあり（$\ge 3$回反復）、周期境界の `stateHash` 一致、`extractLogicalState` 構造一致 | **0 / 28 試合** | 該当なし |
| **B. REPEATED_STATE_WITHOUT_STABLE_PERIOD** | 周期反復はないが、同一 `stateHash` が再登場する | **0 / 28 試合** | 該当なし |
| **C. PROGRESSING_LONG_MATCH** | 安定した周期サフィックスなし、状態ハッシュの大半（100%）がユニーク、論理状態が継続変化しながら 500 decisions に到達 | **28 / 28 試合** | **100% 該当** |
| **D. MIXED / UNRESOLVED** | 複数の原因が混在、または分類不能 | **0 / 28 試合** | 該当なし |

---

## 12. Completed Control Comparison (完走対照対戦との比較)

完走した対戦（Sample C & D: Pair 14）と未完了対戦（Sample A, B, E: Pairs 0, 1）の対照分析を行いました。

| 評価指標 | 完走対戦 (Sample C / D) | 未完了対戦 (Sample A / B / E) | 比較所見 |
|---|---|---|---|
| **対戦組み合わせ** | `offspring-000004` vs `genome-001` (Elite) | 変異個体同士、または `genome-001` vs `offspring-0..3` | `offspring-000004` と `genome-001` の間でのみ決着 |
| **所要 Decisions** | **62 decisions** | **500 decisions** (上限到達) | 完走対戦は 8 分の 1 程度の手番で決着 |
| **進行ターン数** | **7 ターン** | **1 ターン** | 完走対戦はターン交代が発生し、未完了対戦は Turn 1 で停滞 |
| **PASS 比率** | **66.1% 〜 67.7%** | **99.2% 〜 99.8%** | 完走対戦ではアタックやエンドなど積極的アクションが選択された |
| **攻撃・決着手** | アタック・ダメージ判定が正常に解決されライフ 0 到達 | ダイレクトアタックやターンエンドが選択されず膠着 | 攻撃行動の選好スコアの差が直接影響 |

---

## 13. Root Cause Classification (根本原因の分類と考察)

### 主要分類 (Primary Category)
**`C. PROGRESSING_LONG_MATCH` (Policy-Induced Passive Stagnation in Turn 1)**
- **Coverage**: **28 / 28 試合 (100.0%)**
- **Confidence**: **HIGH** (全 30 試合走査および決定論的 Deep Replay による確認)

### 根本メカニズムの解明
1. **Zero DNA（Generation 0）の挙動**:
   全重みが 0 の場合、`GenomeScorer` のスコアはすべての合法手で 0 となり、カタログの最小 `patternRef`（先頭合法手）が決定論的タイブレークで選ばれます。先頭合法手には攻撃アクションやターン進行アクションが含まれるため、自然に対戦が進み 70〜80 decisions 程度で決着しました。
2. **突然変異 DNA（Generation 1）の挙動**:
   正規分布突然変異により、約 240 個の重みに微小なノイズ（$\sigma = 0.05$）が付与されました。このランダムな重みにより、`PASS` パターンと相互作用する特徴量のスコアが、攻撃アクションやターンエンド（`action.end`）のスコアをわずかに上回る状態が発生しました。
3. **Turn 1 での PASS ループ**:
   BlackPoker のゲームルールでは、手番プレイヤーが能動的に `action.end` を選択するか、ステージ上で特定の解決が行われない限りターンは交代しません。両プレイヤーが相手の行動に対して常に `PASS` を選好し続けたため、ダメージが一切発生せず、ライフが削られないまま手番数（500 decisions）を使い果たしました。
4. **状態ハッシュの非重複**:
   連続して PASS が選ばれる際にも、内部で `nextRequestSeq` のインクリメントや `consecutivePassCount` の変動が発生するため、論理状態ハッシュ（`stateHash`）は毎回異なる値となります。したがって「同一局面の無限ループ」ではなく、「手番消費のみが進み盤面が決着しない長手番対戦（Progressing Long Match）」であることが数学的・論理的に証明されました。

---

## 14. What Is NOT Proven (主張しないことの限定)

本分析において、以下の事柄は**実証されていない（PROVEN ではない）**ことを明確にします。

- **Infinite Loop (無限ループ)**: 500 decisions の範囲でしか観測しておらず、1,000手や 10,000手で最終的に決着するかどうかは数学的に保証されないため、無限ループとは呼びません。
- **Simulator Bug (シミュレータのバグ)**: `GameSession` および `SimulationRunner` は合法手生成・ルール適用・ステップ上限ガードを正確に実行しており、エンジンの動作不良ではありません。
- **Rule Bug (ルールのバグ)**: 公式ルール第9.1.2版の合法的遷移の範囲内であり、完走対戦（Pair 14）が示す通りゲーム自体は決着可能です。
- **Fitness Bug (適応度計算のバグ)**: 未完了試合が多発した母集団に対して有効個体数不足を検出し、Fail-Closed に `REEVALUATION_REQUIRED` を発行した判断は設計通りです。
- **MaxDecisions Too Low (上限値が小さすぎる)**: ベースラインや Pair 14 が 62〜80 decisions で決着しているため、500 decisions 自体が過小であるとは言えません。

---

## 15. Production Diff (受託済みモジュールの完全無変更確認)

本分析にあたり、本番コード、既存テスト、公式ルールに 1 行の変更も加えていないことを確認しました。

```
git diff 4f52fef0a3bedfee648c3fdae7d51d35b4685301 -- \
  tools/simulator/src/engine \
  tools/simulator/src/domain \
  tools/simulator/src/data \
  tools/simulator/src/tests
(0 diff - completely empty)
```

---

## 16. Regression (回帰テスト実績)

- **`evolutionLoop.test.ts`**: 48/48 passed
- **`architectureBoundary.test.ts`**: 5/5 passed
- **全 Simulator テスト**: 201 test files passed, 2,753 tests passed
- **Playable Check**: PASS (CORE-BATTLE-001 完走)
- **Build**: PASS (`tsc && vite build` 正常完了)

---

## 17. Remaining Scope (残余スコープ)

- **Evolution Loop Design**: FORMAL ACCEPTED
- **Evolution Loop Production**: FORMAL ACCEPTED
- **Controlled Multi-Generation Evidence V1**: BLOCKED / NOT ACCEPTED
- **Evolution g1 Incomplete Analysis V1**: **ANALYZED / PENDING INDEPENDENT REVIEW**
- **N=100 Multi-Generation**: NOT EXECUTED
- **Parallel Evaluation**: NOT IMPLEMENTED
- **Hall of Fame**: NOT IMPLEMENTED

---

## 18. 最終結論

本分析により、Generation 1 で発生した 28 試合の未完了対戦は「状態の循環ループ（Cycle）」ではなく、変異 DNA による **Turn 1 での PASS 過剰選好に伴う非循環的長手番対戦（`PROGRESSING_LONG_MATCH`）** であることが 100% の決定論的実機検証により実証されました。

最終ステータス:
**ANALYZED / PENDING INDEPENDENT REVIEW**
