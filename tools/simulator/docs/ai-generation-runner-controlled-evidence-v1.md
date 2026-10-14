# BlackPoker Simulator
# Controlled One-Generation Evidence V1-R1 Report

作業ID: `BP-SIM-AI-GENERATION-RUNNER-EVIDENCE-V1-R1`
更新日時: 2026-10-14 16:25 JST
対象ブランチ: `BlackPoker/issue551-core-flow`
ベース HEAD SHA: `f15d5d4530b60bccd2ee2684979100fc67ba5617` (Accepted Production SHA: `2587017da393bd9c96172d5772ea5e0be3ebdb59`)
最終ステータス: **READY FOR INDEPENDENT REVIEW**

---

## 1. 目的とスコープ境界

本作業（R1 Follow-up）の目的は、`BP-SIM-AI-GENERATION-RUNNER-EVIDENCE-V1` の Independent Review で指摘された Evidence Artifact 上の不備（Canonical Context ID の誤謬、Seat Balance の固定値代入、Fail-Closed アサーションの欠如、および本番 API 記述の不一致）を解消し、同一の Controlled Recipe において再度 1 世代実機検証を実施して信用性の高いエビデンスを確定させることです。

検証対象の Production Path:
Official Regulation $\to$ Official Match Setup $\to$ GameSession $\to$ GenomePolicy $\to$ SimulationRunner $\to$ GenerationRunner.aggregateOutcomes $\to$ FitnessEvaluator $\to$ PopulationSelector $\to$ GenerationBuilder

### 実証目標
1. **計画と実行の実測**: 30 試合（$N=6, R=1$）が `GenerationRunner.planSchedule` に基づき過不足なく計画され、実測スケジュールから座席対称性・連続性・自己対戦ゼロが証明されること。
2. **集計と保存則の検証**: COMPLETED / INCOMPLETE / FAILED が集計され、全個体および全試合の保存則が Fail-Closed アサーションにより検証されること。
3. **Canonical Manifest の一致**: `GenerationRunner.run()` の `logicalResult.manifest` から直接取得した `evaluationScheduleId` および `seedScheduleIdentity` が本番契約と完全一致すること。
4. **適応度と判定**: `FitnessEvaluator.evaluateParticipant` により適応度が算出され、`PopulationSelector.assessReadiness` による事前判定が正常に機能すること。
5. **世代交代遷移**: Generation $g=0 \to g=1$ の次世代母集団および `GenerationBuildResult` が正常に生成されること。
6. **決定論性**: 同一プロセス内再実行（Run A-1 vs Run A-2）において、`logicalResult` の Deep Equal および SHA-256 ダイジェストが完全一致すること。

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
- **Python**: 完全不使用（`python`, `python3`, `pip`, `pytest`, `*.py` 一切不使用）
- **Host Node/npm/npx**: 完全不使用（Docker コンテナ内実行へ統一）
- **PowerShell**: 参照専用（ファイル書き込み一切なし）
- **内部パス隔離**: `.gemini/**`, `antigravity/brain/**`, `transcript.jsonl`, `task.md`, `implementation_plan.md` 一切不使用

---

## 3. 実験パラメータ (Canonical Controlled Evidence Recipe)

| パラメータ名 | 設定値 | 決定根拠 / 参照元 |
|---|---|---|
| **Regulation ID** | `light-entry16` | Official Regulation カタログより直接ロード |
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
| **Canonical evaluationScheduleId** | `double-round-robin-v1:r=1:max-decisions=500` | `result.logicalResult.manifest.evaluationScheduleId` 実値 |
| **Canonical seedScheduleIdentity** | `evolution-evaluation-pair-v1:generation-seed=42` | `result.logicalResult.manifest.seedScheduleIdentity` 実値 |
| **Parallelism** | なし (Sequential V1) | 単一スレッド同期実行 |

---

## 4. 本番実行経路と API 整合性 (Production Path Verification)

Evidence Harness (`src/cli/generationRunnerControlledEvidence.ts`) は、本番実装（`GenerationRunner.ts`）と完全に一致する API 呼出経路を通過しました。

1. **`loadRegulationCatalog()`** & **`loadRulePackageFromDirectory()`**: 公式レギュレーション定義および rules-vnext ルールパッケージをディスクから非同期ロード。
2. **`RegulationValidator.validateRegulation("light-entry16")`**: 公式推奨フォーマット・フレームの整合性を検証。
3. **`RegulationRulePackageSelector.selectRulePackage(...)`**: `official-light-entry16` ルールパッケージを選択。
4. **`OfficialRegulationMatchFactory.prepareSessionFactory("light-entry16", { catalog, fullRulePackage })`**: 各試合に決定論的シード（`ctx.matchSeed`）を伝搬する同期 `sessionFactory` を生成。
5. **`OfficialRegulationMatchSetup.setupMatch(...)`**: ロードされた公式レギュレーションおよび rules-vnext パッケージに基づき、山札構築、シャッフル、先攻決定、初期盤面配置を実行。
6. **`GameSession`**: 本番ゲームセッションインスタンスを生成。
7. **`new GenomePolicy(p1Dna)` / `new GenomePolicy(p2Dna)`**: 決定論的 Argmax ポリシーインスタンスを直接生成（※`GenomePolicy.create` などの架空 API ではなく実コンストラクタを使用）。
8. **`SimulationRunner.run(session, policies, { maxDecisions })`**: 最大 500 decisions の範囲で合法手を探索・適用し、対戦を解決。
9. **`GenerationRunner.aggregateOutcomes(schedule, outcomes, population, pairRepetitions)`**: 試合結果をカノニカル順に整列し、個体別の戦績サマリーおよび座席別戦績を集約・保存則検証。
10. **`FitnessEvaluator.evaluateParticipant(summary, resolvedFitnessConfig)`**: 個体ごとの戦績サマリーから勝率・適応度判定（VALID/INSUFFICIENT_EVIDENCE等）・スコアを算出し、`FitnessEvaluationSnapshot` を構築（※`evaluatePopulation` などの架空 API ではなく実メソッドを使用）。
11. **`PopulationSelector.assessReadiness(population, fitnessSnapshot, selectionConfig, evaluationContext)`**: 有効個体数（VALID Count）の十分性を事前判定。
12. **`GenerationBuilder.buildNextGeneration(...)`**: エリート選出、トーナメント親選択、一様交叉、正規分布突然変異により Generation 1 を生成。

---

## 5. スケジュール実測と座席対称性 (Measured Schedule Evidence)

`GenerationRunner.planSchedule(initialPopulation, 42, 1)` から生成された実際のスケジュール配列（30 試合）を直接走査・集計し、以下の性質を厳密にアサート・実測しました。

- **総計画試合数 (`schedule.length`)**: 30 試合
- **matchIndex 連続性**: 0 から 29 まで欠番・重複なし（厳密に連続）
- **自己対戦 (`selfMatchCount`)**: 0 件（全試合で `p1GenomeId !== p2GenomeId`）
- **鏡像ペア (Mirrored Pairs)**: 15 ペアすべてにおいて、Leg 0 と Leg 1 で P1/P2 の座席が反転し、かつ同一の `matchSeed` が付与されていることを確認。

### 実測座席バランス表 (実スケジュール走査集計)

| Genome ID | 実測総試合数 (`total`) | P1 割当数 (`asP1`) | P2 割当数 (`asP2`) | 座席対称性検証 |
|---|---|---|---|---|
| `genome-000` | 10 | 5 | 5 | PASS (完全対称) |
| `genome-001` | 10 | 5 | 5 | PASS (完全対称) |
| `genome-002` | 10 | 5 | 5 | PASS (完全対称) |
| `genome-003` | 10 | 5 | 5 | PASS (完全対称) |
| `genome-004` | 10 | 5 | 5 | PASS (完全対称) |
| `genome-005` | 10 | 5 | 5 | PASS (完全対称) |

---

## 6. Canonical Manifest 検証 (Authoritative Context ID)

`result.logicalResult.manifest` から直接取得・記録した Authoritative な設定識別子は以下の通りです（ハードコードや推測による値ではなく、本番 Runner の出力と完全一致）。

- **`manifest.generation`**: `0`
- **`manifest.populationSize`**: `6`
- **`manifest.pairRepetitions`**: `1`
- **`manifest.totalMatches`**: `30`
- **`manifest.generationSeed`**: `42`
- **`manifest.evaluationScheduleId`**: `double-round-robin-v1:r=1:max-decisions=500`
- **`manifest.seedScheduleIdentity`**: `evolution-evaluation-pair-v1:generation-seed=42`
- **Run A-1 vs Run A-2 Manifest 一致**: Deep Equal (完全一致)

---

## 7. 実行結果サマリー

### Run A-1 実測値
- **論理結果ステータス**: `ADVANCED`
- **対戦総数**: 30 試合（計画 30 / 完走 30 / 中断 0 / 失敗 0）
- **総意思決定数 (`totalDecisions`)**: 2,196 decisions
- **壁時計実行時間**: 3,235.57 ms (約 3.24 秒)
- **対戦実行実時間 (`matchExecutionElapsedMs`)**: 3,185 ms
- **対戦処理速度 (`matchesPerSecond`)**: 9.42 matches/sec (対戦実時間ベース) / 9.27 matches/sec (壁時計ベース)
- **論理結果 SHA-256 ダイジェスト**: `98cb84d54aeba6efda1f1de18b50e7016a45aabc6dc9b2a986b0b668f6eb1c98`

### Run A-2 実測値 (同一プロセス・同一入力再実行)
- **論理結果ステータス**: `ADVANCED`
- **対戦総数**: 30 試合（計画 30 / 完走 30 / 中断 0 / 失敗 0）
- **総意思決定数 (`totalDecisions`)**: 2,196 decisions
- **壁時計実行時間**: 3,141.52 ms (約 3.14 秒)
- **対戦実行実時間 (`matchExecutionElapsedMs`)**: 3,103 ms
- **対戦処理速度 (`matchesPerSecond`)**: 9.67 matches/sec (対戦実時間ベース) / 9.55 matches/sec (壁時計ベース)
- **論理結果 SHA-256 ダイジェスト**: `98cb84d54aeba6efda1f1de18b50e7016a45aabc6dc9b2a986b0b668f6eb1c98`

### 決定論的検証結果
- **`digestsEqual`**: **`true`**
- **`logicalDeepEqual`**: **`true`**
- **決定論性保証スコープ**:
  本決定論性は、「同一のサポート対象ランタイム（Node.js v20 LTS on Linux x86_64）、同一の実装コード、同一の入力母集団、同一の Generation Seed、同一のプロセス内実行」において厳密に成立することを証明したものです。異種 OS / 異種 CPU / 異種 Node.js バージョン間での universal bit-exactness を過剰に主張するものではありません。

---

## 8. 個体別詳細対戦・適応度実績 (Per-Genome Evidence)

全 6 個体について、実測された対戦数・勝敗・適応度ステータスを以下に示します。

| Genome ID | 計画試合数 | 完走試合数 | 勝数 (W) | 敗数 (L) | 分数 (D) | 未完了数 | 適応度判定 | 適応度スコア | P1 割当 | P2 割当 |
|---|---|---|---|---|---|---|---|---|---|---|
| `genome-000` | 10 | 10 | 5 | 5 | 0 | 0 | **VALID** | **0.500** | 5 | 5 |
| `genome-001` | 10 | 10 | 5 | 5 | 0 | 0 | **VALID** | **0.500** | 5 | 5 |
| `genome-002` | 10 | 10 | 5 | 5 | 0 | 0 | **VALID** | **0.500** | 5 | 5 |
| `genome-003` | 10 | 10 | 5 | 5 | 0 | 0 | **VALID** | **0.500** | 5 | 5 |
| `genome-004` | 10 | 10 | 5 | 5 | 0 | 0 | **VALID** | **0.500** | 5 | 5 |
| `genome-005` | 10 | 10 | 5 | 5 | 0 | 0 | **VALID** | **0.500** | 5 | 5 |

### 保存則と整合性のアサーション結果 (Fail-Closed Assertions)
- **`manifest.totalMatches === 30`**: PASS
- **`schedule.length === 30`**: PASS
- **`observedCompletedMatches + observedIncompleteMatches === 30`**: PASS
- **`failedMatches === 0`**: PASS
- **全個体 `scheduledMatches === 10`**: PASS
- **全個体 `asP1 === 5` かつ `asP2 === 5`**: PASS
- **全個体 `selfMatches === 0`**: PASS
- **全個体 `wins + losses + draws === completedMatches`**: PASS
- **全個体 `completedMatches + incompleteMatches === scheduledMatches`**: PASS
- **Run A-1 vs Run A-2 `logicalDeepEqual`**: PASS
- **Run A-1 vs Run A-2 `digestsEqual`**: PASS

---

## 9. 世代交代・次世代母集団遷移 (Generation Transition)

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
  - `buildResult` 存在: YES
  - `buildResult.eliteCount`: 1
  - `buildResult.offspringCount`: 5
  - `buildResult.eliteGenomeIds`: `["genome-000"]`（同点タイブレークによる決定論的選出）

---

## 10. 実行性能と外挿推計 (Performance & Extrapolation)

### 30 試合実測性能
- **実測実行時間**: 約 3.14 秒 〜 3.24 秒
- **実測処理速度**: **9.27 〜 9.67 matches/second**
- **1 試合平均時間**: 約 103 〜 108 ms/match
- **1 意思決定平均時間**: 約 1.4 〜 1.5 ms/decision（2,196 decisions / ~3.2s）

### 9,900 試合シーケンシャル実行推計 (参考外挿値)
$$T_{\text{extrapolated}} = \frac{9{,}900}{\text{observedMatchesPerSecond}} \approx \frac{9{,}900}{9.42} \approx 1{,}050 \text{ 秒 (約 17.5 分)}$$

> [!WARNING]
> **外挿推計（EXTRAPOLATED ESTIMATE ONLY）に関する明確な注意**:
> 上記の 9,900 試合実行時間（約 17〜18 分）は、今回の $N=6$（30 試合）の実測スループットに基づく**単純数学的外挿値**であり、直接の実測値ではありません。
> $N=100$ におけるメモリフットプリント、ガベージコレクションオーバーヘッド、または長手番展開の変動によってスループットが変化する可能性があり、本エビデンスは $N=100$ での同一速度や性能保証を証明するものではありません。

---

## 11. 主張の限定 (Do Not Overclaim)

本エビデンスにより厳密に実証された範囲および実証されていない範囲を以下に明確化します。

### 実証された範囲（PROVEN）
- 公式 `light-entry16` レギュレーション、公式セットアップ、`GameSession`、`GenomePolicy`、`SimulationRunner`、`GenerationRunner`、`FitnessEvaluator`、`PopulationSelector`、`GenerationBuilder` の完全な本番 E2E 結合。
- $N=6, R=1, \text{seed}=42, \text{maxDecisions}=500$ における 30 試合の完全完走（0 failed, 0 incomplete）。
- 実スケジュール走査による座席対称性（各個体 P1=5, P2=5）、matchIndex 連続性、自己対戦ゼロの実測実証。
- カノニカル設定識別子（`evaluationScheduleId` / `seedScheduleIdentity`）の本番マニフェスト直接照合。
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

## 12. 受託済みモジュールの完全無変更監査 (Zero Diff Audit)

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

さらに、公式レギュレーション実装に対しても変更ゼロであることを確認しました。
```
git diff --exit-code -- \
  tools/simulator/src/engine/regulation/OfficialRegulationMatchFactory.ts \
  tools/simulator/src/engine/regulation/OfficialRegulationMatchSetup.ts
(0 diff - completely empty)
```

---

## 13. 最終結論

本 Controlled Evidence V1-R1 は、前回の指摘事項をすべて解消し、計画された 30 試合を全戦正常決着（COMPLETED）で完走、実スケジュール走査による座席対称性・Authoritative Manifest 照合・Fail-Closed 保存則アサーション・適応度計算・事前判定・次世代母集団生成（Generation $g=0 \to 1$）および完全な決定論性（ダイジェスト一致）を実証しました。

最終ステータス:
**READY FOR INDEPENDENT REVIEW**
