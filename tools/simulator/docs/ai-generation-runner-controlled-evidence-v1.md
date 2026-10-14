# BlackPoker Simulator
# Controlled One-Generation Evidence V1 Report

作業ID: `BP-SIM-AI-GENERATION-RUNNER-EVIDENCE-V1`  
更新日時: 2026-10-14 16:05 JST  
対象ブランチ: `BlackPoker/issue551-core-flow`  
開始 HEAD SHA: `2587017da393bd9c96172d5772ea5e0be3ebdb59`  
最終ステータス: **READY FOR INDEPENDENT REVIEW**

---

## 1. 目的とスコープ境界

本作業の目的は、Formal Accepted 済みの `GenerationRunner` 本番実装（SHA: `2587017da393bd9c96172d5772ea5e0be3ebdb59`）を、モックやダミーではない実在の本番パス（Official Regulation $\to$ Official Match Setup $\to$ GameSession $\to$ GenomePolicy $\to$ SimulationRunner $\to$ FitnessEvaluator $\to$ PopulationSelector $\to$ GenerationBuilder）において実際に 1 世代実行し、次の事項を制御下エビデンス（Controlled Evidence）として実証することです。

1. **計画と実行**: 30 試合（$N=6, R=1$）が決定論的スケジュールに基づき正しく計画・実行されること。
2. **集計の整合性**: COMPLETED / INCOMPLETE / FAILED が正しく集計され、対戦・勝敗保存則が成立すること。
3. **適応度と判定**: `FitnessEvaluator` により Authoritative な適応度スナップショットが生成され、`PopulationSelector` の事前判定が正しく機能すること。
4. **世代交代遷移**: 有効個体数が満たされた場合に `GenerationBuilder` が呼び出され、Generation $g=0 \to g=1$ の次世代母集団が正常に生成されること。
5. **論理的決定論性**: 同一入力・同一シードによる同一プロセス再実行（Run A-1 vs Run A-2）において、`logicalResult` が Deep Equal かつ SHA-256 ダイジェストレベルで 1 ビットの狂いもなく完全一致すること。
6. **実測実行時間**: 実測の壁時計実行時間および matches/sec を取得・記録すること。

### 非スコープ・禁止事項
- 大量実行（$N=100$, 9,900 試合）は実行しない。
- 複数世代進化ループ（Evolution Loop）は実装しない。
- 並列実行（worker_threads, multi-process）は行わない（Sequential V1 のみ）。
- 本番モジュールの変更は一切行わない（Production Diff 0）。
- 結果を良く見せるための設定改変（閾値緩和、シード探索、ゲノム差し替え等）は一切行わない。

---

## 2. 実行環境とプロセス遵守

- **Docker コンテナ**: `bp-simulator`
- **Node.js ランタイム**: `v20.20.2` (Docker Linux x86_64)
- **Python**: 完全不使用（`python`, `python3`, `pip`, `pytest` 一切不使用）
- **Host Node/npm/npx**: 完全不使用（Docker コンテナ内実行へ統一）
- **PowerShell**: 参照専用（ファイル書き込み一切なし）
- **内部パス隔離**: `.gemini/**`, `antigravity/brain/**`, `transcript.jsonl`, `task.md`, `implementation_plan.md` 一切不使用

---

## 3. 実験パラメータ (Canonical Controlled Evidence Recipe)

| パラメータ名 | 設定値 | 決定根拠 / 参照元 |
|---|---|---|
| **Regulation ID** | `light-entry16` | Official Regulation 定義より直接ロード |
| **Format ID** | `light` | `RegulationDefinition.formatId` 実測値 |
| **Frame ID** | `entry16` | `RegulationDefinition.frameId` 実測値 |
| **Rule Package Version** | `1.0.0` | `officialRulePackage.version` 実測値 |
| **Environment Ref** | `official:light-entry16` | `GenerationRunnerEnvironmentContext` 規約 |
| **Population Size ($N$)** | `6` | 最小かつ十全な検証母集団サイズ ($N \ge 2$) |
| **Target Generation ($g$)** | `0` | 初期世代 |
| **Genome IDs** | `genome-000` 〜 `genome-005` | 決定論的 6 個体 |
| **DNA Type** | `Zero Decision DNA` | `DecisionDNACodec.createZeroDecisionDNA()` |
| **Pair Repetitions ($R$)** | `1` | Canonical Double Round Robin |
| **Total Matches ($M$)** | `30` | $N(N-1)R = 6 \times 5 \times 1 = 30$ |
| **Scheduled Matches / Genome** | `10` | $2(N-1)R = 2 \times 5 \times 1 = 10$ |
| **Generation Seed** | `42` | Canonical Controlled Seed |
| **Max Decisions / Match** | `500` | ステップ上限ガード |
| **Fitness Config** | `minCompleted: 10, minRate: 0.50` | `DEFAULT_FITNESS_EVALUATION_CONFIG` (無改変) |
| **Builder Config** | `populationSize: 6, elite: 1, tourney: 3` | `DEFAULT_GENERATION_BUILDER_CONFIG` 準拠 |
| **Evaluation Schedule ID** | `drr:r1:v1` | `canonicalEvaluationScheduleId(1)` |
| **Seed Schedule Identity** | `seed:42:v1` | `canonicalSeedScheduleIdentity(42)` |
| **Parallelism** | なし (Sequential V1) | 単一スレッド同期実行 |

---

## 4. 本番実行経路 (Production Path Evidence)

Evidence Harness (`src/cli/generationRunnerControlledEvidence.ts`) は、以下の本番クラス・本番メソッドを一切モックせず、公式実機経路をそのまま通過しました。

1. **`loadRegulationCatalog()`** & **`loadRulePackageFromDirectory()`**: 公式レギュレーション定義および rules-vnext DSL ルールパッケージをディスクから非同期ロード。
2. **`RegulationValidator.validateRegulation("light-entry16")`**: 公式推奨フォーマット・フレームの整合性を検証。
3. **`RegulationRulePackageSelector.selectRulePackage(...)`**: `official-light-entry16` 派生ルールパッケージを抽出。
4. **`OfficialRegulationMatchFactory.prepareSessionFactory("light-entry16")`**: 各試合に決定論的シード（`ctx.matchSeed`）を伝搬する同期 `sessionFactory` を生成。
5. **`OfficialRegulationMatchSetup.setupMatch(...)`**: 公式ルール第9.1.2版に基づく山札構築、シャッフル、先攻決定、初期盤面配置を実行。
6. **`GameSession`**: 本番ゲームセッションインスタンスを生成。
7. **`GenomePolicy.create(dna)`**: 決定論的 Argmax ポリシーとしてバインド。
8. **`SimulationRunner.run(...)`**: 最大 500 decisions の範囲で合法手を探索・適用し、対戦を解決。
9. **`FitnessEvaluator.evaluatePopulation(...)`**: 対戦結果から各個体の勝率・適応度スコアを算出。
10. **`PopulationSelector.assessReadiness(...)`**: 有効個体数（VALID Count）の十分性を事前判定。
11. **`GenerationBuilder.buildNextGeneration(...)`**: エリート選出、トーナメント親選択、一様交叉、正規分布突然変異により Generation 1 を生成。

---

## 5. 実行結果サマリー

### Run A-1 実測値
- **論理結果ステータス**: `ADVANCED`
- **対戦総数**: 30 試合（計画 30 / 完走 30 / 中断 0 / 失敗 0）
- **総意思決定数 (`totalDecisions`)**: 2,196 decisions
- **壁時計実行時間**: 3,728.87 ms (約 3.73 秒)
- **対戦実行実時間 (`matchExecutionElapsedMs`)**: 3,673 ms
- **対戦処理速度 (`matchesPerSecond`)**: 8.17 matches/sec
- **論理結果 SHA-256 ダイジェスト**: `98cb84d54aeba6efda1f1de18b50e7016a45aabc6dc9b2a986b0b668f6eb1c98`

### Run A-2 実測値 (同一プロセス再実行)
- **論理結果ステータス**: `ADVANCED`
- **対戦総数**: 30 試合（計画 30 / 完走 30 / 中断 0 / 失敗 0）
- **総意思決定数 (`totalDecisions`)**: 2,196 decisions
- **壁時計実行時間**: 3,317.00 ms (約 3.32 秒)
- **対戦実行実時間 (`matchExecutionElapsedMs`)**: 3,266 ms
- **対戦処理速度 (`matchesPerSecond`)**: 9.19 matches/sec
- **論理結果 SHA-256 ダイジェスト**: `98cb84d54aeba6efda1f1de18b50e7016a45aabc6dc9b2a986b0b668f6eb1c98`

### 決定論的検証結果
- **`digestsEqual`**: **`true`**
- **`logicalDeepEqual`**: **`true`**
- **検証評価**: 同一入力・同一シードにおける完全な再現性（bit-exact）を確認。

---

## 6. 個体別詳細対戦・適応度実績 (Per-Genome Evidence)

全 6 個体について、対戦数・勝敗・適応度ステータスを実測記録しました。

| Genome ID | 計画試合数 | 完走試合数 | 勝数 (W) | 敗数 (L) | 分数 (D) | 未完了数 | 適応度判定 | 適応度スコア | P1 試合数 | P2 試合数 |
|---|---|---|---|---|---|---|---|---|---|---|
| `genome-000` | 10 | 10 | 5 | 5 | 0 | 0 | **VALID** | **0.500** | 5 | 5 |
| `genome-001` | 10 | 10 | 5 | 5 | 0 | 0 | **VALID** | **0.500** | 5 | 5 |
| `genome-002` | 10 | 10 | 5 | 5 | 0 | 0 | **VALID** | **0.500** | 5 | 5 |
| `genome-003` | 10 | 10 | 5 | 5 | 0 | 0 | **VALID** | **0.500** | 5 | 5 |
| `genome-004` | 10 | 10 | 5 | 5 | 0 | 0 | **VALID** | **0.500** | 5 | 5 |
| `genome-005` | 10 | 10 | 5 | 5 | 0 | 0 | **VALID** | **0.500** | 5 | 5 |

### 保存則とバランスの検証
1. **Seat Balance (座席対称性)**: 全個体において P1 割当 5 回、P2 割当 5 回（合計 10 試合）が厳密に成立。自己対戦（Self Match）は 0 件。
2. **勝敗保存則**: 全個体において $W + L + D = 5 + 5 + 0 = 10 = \text{completedMatches}$ が厳密に成立。
3. **試合数保存則**: 全個体において $\text{completedMatches} + \text{incompleteMatches} = 10 + 0 = 10 = \text{scheduledMatches}$ が厳密に成立。
4. **全対戦の完走**: 30 試合すべてが正常決着（Life 0 による決着）し、未完了試合（Incomplete）および例外終了（Failed）は 0 件。

---

## 7. 世代交代・次世代母集団遷移 (Generation Transition)

- **Selection Readiness**:
  - `status`: `"READY"`
  - `validCount`: 6（全 6 個体が VALID）
  - `requiredCount`: 3（$\max(\text{minimumValidPopulationCount: 2}, \text{tournamentSize: 3}) = 3$）
  - 有効個体数判定条件（$\text{validCount} \ge 3$ かつ $\text{validCount} \ge \text{eliteCount: 1}$）を完全に充足。
- **Generation Transition 実績**:
  - `status`: `"ADVANCED"`
  - `sourceGeneration`: 0
  - `targetGeneration`: 1
  - `nextPopulation.generation`: 1
  - `nextPopulation.entries.length`: 6
  - `buildResult.eliteCount`: 1
  - `buildResult.offspringCount`: 5
  - `buildResult.eliteGenomeIds`: `["genome-000"]`（同点タイブレークによる決定論的選出）

---

## 8. 実行性能と外挿推計 (Performance & Extrapolation)

### 30 試合実測性能
- **実測実行時間**: 約 3.3 秒 〜 3.7 秒
- **実測処理速度**: **8.17 〜 9.19 matches/second**（平均 約 8.68 matches/sec）
- **1 試合平均時間**: 約 110 〜 124 ms/match
- **1 意思決定平均時間**: 約 1.5 〜 1.7 ms/decision（2,196 decisions / ~3.5s）

### 9,900 試合シーケンシャル実行推計 (参考外挿値)
$$T_{\text{extrapolated}} = \frac{9{,}900}{\text{observedMatchesPerSecond}} \approx \frac{9{,}900}{8.68} \approx 1{,}140 \text{ 秒 (約 19 分)}$$

> [!WARNING]
> **外挿推計（EXTRAPOLATED ESTIMATE）に関する明確な注意**:
> 上記の 9,900 試合実行時間（約 18〜21 分）は、今回の $N=6$（30 試合）の実測スループットに基づく**単純数学的外挿値**であり、直接の実測値ではありません。
> $N=100$ におけるメモリフットプリント、ガベージコレクションオーバーヘッド、または長手番展開の変動によってスループットが変化する可能性があり、本エビデンスは $N=100$ での同一速度や性能保証を証明するものではありません。

---

## 9. 主張の限定 (Do Not Overclaim)

本エビデンスにより厳密に実証された範囲および実証されていない範囲を以下に明確化します。

### 実証された範囲（PROVEN）
- 公式 `light-entry16` レギュレーション、公式セットアップ、`GameSession`、`GenomePolicy`、`SimulationRunner`、`GenerationRunner`、`FitnessEvaluator`、`PopulationSelector`、`GenerationBuilder` の完全な本番 E2E 結合。
- $N=6, R=1, \text{seed}=42, \text{maxDecisions}=500$ における 30 試合の完全完走（0 failed, 0 incomplete）。
- 同一プロセス内再実行による完全な論理決定論性（Deep Equal / SHA-256 ダイジェスト一致）。
- 世代交代パイプライン（Generation $0 \to 1$）の正常終了と次世代スナップショットの獲得。

### 実証されていない範囲（NOT PROVEN）
- $N=100$ / 9,900 試合の大規模実行
- 並列実行スケーリング（Worker threads / マルチプロセス）
- 他の公式レギュレーション（`standard-pack`, `pro-rarePack` 等）での自己対戦
- 複数世代進化ループ（Evolution Loop: 100 世代等の長期走行）
- AI ポリシーの定量的強度向上（Strength Improvement）
- Hall of Fame（殿堂入り）メカニズム

---

## 10. 受託済みモジュールの完全無変更監査 (Zero Diff Audit)

本エビデンス取得にあたり、受託済みのすべての本番モジュールに対して 1 行の変更も加えていないことを確認しました。

```
git diff --exit-code -- \
  tools/simulator/src/engine/ai/GenerationRunner.ts \
  tools/simulator/src/domain/ai/GenerationRunnerTypes.ts \
  tools/simulator/src/engine/ai/GenerationBuilder.ts \
  tools/simulator/src/domain/ai/GenerationBuilderTypes.ts \
  tools/simulator/src/engine/ai/FitnessEvaluator.ts \
  tools/simulator/src/domain/ai/FitnessEvaluationTypes.ts \
  tools/simulator/src/engine/ai/PopulationSelector.ts \
  tools/simulator/src/domain/ai/PopulationSelectionTypes.ts \
  tools/simulator/src/engine/ai/GeneticOperators.ts \
  tools/simulator/src/engine/simulation/SimulationRunner.ts \
  tools/simulator/src/engine/ai/GenomePolicy.ts \
  tools/simulator/src/engine/session/GameSession.ts
(0 diff - completely empty)
```

---

## 11. 最終結論

本 Controlled Evidence は計画された 30 試合を全戦正常決着（COMPLETED）で完走し、適応度計算・事前判定・次世代母集団生成（Generation $g=0 \to 1$）および完全な決定論性（ダイジェスト一致）を実証しました。

最終ステータス:
**READY FOR INDEPENDENT REVIEW**
