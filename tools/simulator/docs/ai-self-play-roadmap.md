# BlackPoker Simulator AI Self-Play & Decision DNA ロードマップ

作業ID: `BP-SIM-AI-1.3.1-20260904-2207`
更新日時: 2026-09-04 22:07 JST

---

## 1. Current Capability Matrix

| Capability | Status | Existing Implementation | Test / CLI Evidence | Next Action |
|---|---|---|---|---|
| **Headless single match** | **IMPLEMENTED** | `src/engine/simulation/SimulationRunner.ts` | `src/tests/simulation/headlessSimulation.test.ts`, `playable:check`, `simulate:single` | 安定稼働中 |
| **AI Policy common interface** | **IMPLEMENTED** | `src/engine/simulation/DecisionPolicy.ts` (`DecisionPolicy`, `PolicyDescriptor`) | `src/controller/BlackPokerPolicy.ts` と統合 | DNA Policy へ拡張可能 |
| **First Legal baseline Policy** | **IMPLEMENTED** | `src/engine/simulation/DecisionPolicy.ts` (`FirstLegalPolicy`) | `src/tests/simulation/headlessSimulation.test.ts` | baseline AI として利用 |
| **Random Policy (Seeded)** | **IMPLEMENTED** | `src/engine/simulation/DecisionPolicy.ts` (`RandomPolicy`) | `src/tests/simulation/seededDeterminism.test.ts` | 決定論的ランダム対戦 |
| **Seeded RNG** | **IMPLEMENTED** | `src/engine/random/RandomSource.ts` (`SeededRandom` / Mulberry32) | `src/tests/simulation/seededDeterminism.test.ts` | PRNG 再現性保証 |
| **Deterministic Logical Re-execution** | **IMPLEMENTED** | `SimulationRunner.run` + `SeededRandom` | `src/tests/simulation/seededDeterminism.test.ts` (100% trace/hash 一致検証) | 同一入力での決定論的論理トレース完全再現 |
| **Runtime Decision ID** | **NON-DETERMINISTIC BY DESIGN** | `DecisionRequest.id` (`dec-${Date.now()}-...`) | `GameSession` / `CanonicalMatchLog` 照合用 | 実行時相関専用 |
| **Logical Decision ID** | **IMPLEMENTED** | `SimulationRunner` (`d2-${step}-${player}-v${version}-${hash}`) | `src/tests/simulation/seededDeterminism.test.ts` | 永続トレース・Replay・AI分析用 |
| **Logical Pattern Key** | **IMPLEMENTED** | `generateLogicalPatternKey` (selection refs ベース) | `src/tests/simulation/seededDeterminism.test.ts` | 意味論的合法手一意識別 |
| **Decision Trace v2** | **IMPLEMENTED** | `src/engine/simulation/SimulationRunner.ts` (`decisionTraceVersion: 2`) | `src/tests/simulation/seededDeterminism.test.ts`, `simulate:single` | logicalDecisionId / logicalPatternKey 包含 |
| **State Hash v2** | **IMPLEMENTED** | `src/engine/simulation/StateHasher.ts` (`stateHashVersion: 2`, 標準 FNV-1a 64-bit) | `src/tests/simulation/seededDeterminism.test.ts` | turnUsage/nextRequestSeq包含, player.name除外 |
| **GameSession Snapshot v1** | **IMPLEMENTED** | `src/engine/session/GameSessionSnapshotCodec.ts`, `GameSession.createSnapshot()` | `src/tests/simulation/sessionSnapshot.test.ts` | JSON-safe DTO (Format Version 1) |
| **GameSession Resume** | **IMPLEMENTED** | `src/engine/session/GameSessionSnapshotCodec.ts`, `GameSession.fromSnapshot()` | `src/tests/simulation/sessionSnapshot.test.ts` | 途中保存・復元、分岐(What-if)対応 |
| **PASS-in-Stage Resume** | **IMPLEMENTED** | `src/engine/session/GameSessionSnapshotCodec.ts` | `src/tests/simulation/sessionSnapshot.test.ts` | Stage上に実Request存在下でのPASS解決保証 |
| **EFFECT_SELECTION Resume** | **IMPLEMENTED** | `src/engine/session/GameSessionSnapshotCodec.ts` | `src/tests/simulation/sessionSnapshot.test.ts` | 多段階効果解決中断からの完全再開 |
| **RulePackage Validation** | **IMPLEMENTED** | `GameSessionSnapshotCodec.restore` | `src/tests/simulation/sessionSnapshot.test.ts` | id / version 不一致の厳格な reject |
| **Batch Simulation v1** | **IMPLEMENTED** | `src/engine/simulation/BatchSimulationRunner.ts`, `src/domain/simulation/BatchSimulationTypes.ts` | `src/tests/simulation/batchSimulation.test.ts`, `npm run simulate:batch` | 決定論的バッチ対戦・集計基盤 |
| **Failure Isolation** | **IMPLEMENTED** | `BatchSimulationRunner.ts` (`BatchFailureRecord`, `stopOnError: false`) | `src/tests/simulation/batchSimulation.test.ts` | 異常試合の隔離とバッチ継続完走 |
| **Deterministic Match Planning** | **IMPLEMENTED** | `BatchSimulationRunner.planMatch`, `deriveSeed` (FNV-1a 32-bit 純粋関数) | `src/tests/simulation/batchSimulation.test.ts` | 実行順序非依存・単独再現性保証 |
| **Fresh Session / Policy Isolation** | **IMPLEMENTED** | `sessionFactory` / `policyFactory` 契約 & テスト保証 | `src/tests/simulation/batchSimulation.test.ts` | 試合間インスタンス独立性保証 |
| **Logical Result / Runtime Metrics Separation** | **IMPLEMENTED** | `BatchMatchResult` / `BatchSimulationRuntimeMetrics` 分離 | `src/tests/simulation/batchSimulation.test.ts` | 同一Seedでの100% Logical JSON一致保証 |
| **Master + Extra Generic Compatibility** | **IMPLEMENTED** | Action / Component 非依存な抽象インターフェース設計 | `BatchSimulationRunner.ts` | 拡張DSL追加でのBatchRunner改修不要 |
| **Failure Reproduction Recipe** | **IMPLEMENTED** | `BatchFailureRecord` (`baseSeed`, `matchIndex`, `matchSeed`, `playerSeeds`) | `src/tests/simulation/batchSimulation.test.ts` | 失敗試合の同一プラン再構築保証 |
| **Automatic Failure Re-run** | **MISSING / FUTURE** | - | - | 失敗試合の自動再実行API (将来) |
| **Parallel Batch** | **MISSING / FUTURE** | - | - | Worker thread / マルチプロセス並列実行 (将来) |
| **Replay from saved data** | **MISSING** | - | - | 保存済み Trace からの再生エンジン (将来) |
| **Canonical Match Log** | **IMPLEMENTED** | `src/domain/log/CanonicalMatchLog.ts`, `src/engine/log/MatchLogRecorder.ts` | `src/tests/rules-vnext/canonicalMatchLog.test.ts`, `GameSession.getMatchLog()` | Replay / ログ解析に活用 |
| **AI Policy / RNG Checkpoint** | **MISSING / FUTURE** | - | - | Simulation Runner レベルでの乱数状態を含むチェックポイント |
| **Policy versioning** | **IMPLEMENTED** | `PolicyDescriptor` (`kind`, `policyVersion`, `metadata`) | `src/engine/simulation/DecisionPolicy.ts` | Version 管理対応済み |
| **DNA format** | **MISSING** | - | - | Phase 3.0 で策定 |
| **Feature Encoder** | **MISSING** | - | - | Phase 3.0 で策定 |
| **Genome Policy** | **MISSING** | - | - | Phase 3.0 で策定 |
| **Evolution** | **MISSING** | - | - | Phase 4.0 で策定 |
| **Hall of Fame** | **MISSING** | - | - | Phase 4.0 で策定 |

---

## 2. Match Snapshot & Resume Foundation (Phase 1.2.1)

### アーキテクチャとデータフロー
```text
GameSession (WAITING_FOR_DECISION などの Stable Boundary)
    ↓
session.createSnapshot() ──> GameSessionSnapshot (JSON-safe DTO, Version: 1)
    │                         ├─ metadata (matchId, rulePackageRef: RulePackage.id, rulesVersion: RulePackage.version, createdAt)
    │                         ├─ gameState (Raw GameState clone)
    │                         ├─ gameStateHash ("sh2-..." State Hash v2)
    │                         ├─ session (consecutivePassCount, pendingDecision, continuation, resolvingRequest, resolvingContext)
    │                         └─ matchLog (CanonicalMatchLog prefix)
    ↓
JSON.stringify(snapshot) / JSON.parse(json) (JSON Round-Trip 保証)
    ↓
GameSession.fromSnapshot(snapshot, rulePackage) (検証: Version, 必須フィールド, State Hash 照合, RulePackage id/version 照合)
    ↓
Restored GameSession (同じ DecisionResponse を適用して Original と同一の GameState 遷移を再開)
```

---

## 3. Batch Simulation & Failure Isolation Foundation (Phase 1.3 / 1.3.1 完了状態)

### アーキテクチャとデータフロー
```text
BatchSimulationRunner.run(options)
    │
    ├─ 0. validateOptions(options) ──> 不正設定は即時 throw (BatchSimulationConfigurationError, ファクトリ未呼出)
    │
    ├─ for matchIndex = 0 .. matchCount - 1:
    │     │
    │     ├─ planMatch(baseSeed, matchIndex)
    │     │     ├─ matchSeed = deriveSeed(baseSeed, matchIndex, "match")
    │     │     ├─ p1Seed    = deriveSeed(baseSeed, matchIndex, "p1")
    │     │     └─ p2Seed    = deriveSeed(baseSeed, matchIndex, "p2")
    │     │
    │     ├─ try {
    │     │     session  = options.sessionFactory(context)   // fresh instance (別オブジェクト参照)
    │     │     policies = options.policyFactory(context)    // fresh instance with derived seeds
    │     │     result   = SimulationRunner.run(session, policies, { maxDecisions })
    │     │  } catch (err) {
    │     │     record BatchFailureRecord (phase, error, seeds)
    │     │     continue next match (Failure Isolation)
    │     │  }
    │     │
    │     └─ compact BatchMatchResult (COMPLETED | INCOMPLETE | FAILED) (durationMs は分離)
    │
    ├─ calculateSummary() ──> BatchSimulationSummary (totalExecutionTimeMs は分離)
    └─ runtimeMetrics     ──> BatchSimulationRuntimeMetrics (非決定論的実行時メトリクス)
```

### 主要設計仕様
1. **batchResultVersion**: `1`
2. **Master + Extra 互換原則**:
   - `BatchSimulationRunner` は、`action.attack` や `action.block` などの Action ID、特定の Trump、Fog、Component の内容を一切解釈しません。
   - `RulePackage`, `GameSession`, `SimulationRunner`, `DecisionPolicy` の抽象境界のみを利用します。
   - したがって、既存 DSL / Core で表現可能な新しい Action や Component を追加する際、原則として `BatchRunner` の改修は不要です。
   - 改修が必要となるのは、新しい Decision 種別、新しい GameState 論理状態、新しい Session 中断状態など、Core 全体の一般能力を追加した場合に限られます。
   - `attackCount` や `blockCount` などのアクション固有統計は BatchSummary には含めず、将来の `Canonical Match Log Analytics` の責務として分離します。
3. **Session / Policy Factory 契約 & インスタンス独立性**:
   - `sessionFactory` および `policyFactory` は、各試合（`BatchMatchContext`）ごとに完全に独立した fresh なインスタンス（別オブジェクト参照）を生成して返す契約です。
   - テストスイートにより、`GameSession`、`p1 Policy`、`p2 Policy` が全試合で異なるインスタンスであること、および同一試合内の `p1` と `p2` が異なるインスタンスであることが厳格に保証されています。
4. **Logical Result と Runtime Metrics の明確な分離**:
   - `BatchMatchResult`（勝敗、判断数、ターン数、State Hash v2）および `BatchSimulationSummary`（完了数、未完了数、勝率など）は純粋な決定論的論理結果です。
   - `durationMs` や `totalExecutionTimeMs` などの実行時タイミング情報は `runtimeMetrics`（`BatchSimulationRuntimeMetrics`）へ分離されています。
   - これにより、同一 `baseSeed` での実行において、`JSON.stringify(logicalResultA) === JSON.stringify(logicalResultB)` の 100% 決定論的完全一致が保証されます。
5. **純粋関数 Seed 導出 (`deriveSeed`)**:
   - `deriveSeed(baseSeed, matchIndex, streamKey)`: FNV-1a 32-bit アルゴリズムによる純粋関数。
   - 他の試合の実行有無や実行順序に一切依存せず、Match #N のシードを単独で一意算出可能。
6. **決定論的 Match ID**:
   - `batch-${baseSeed}-match-${String(matchIndex).padStart(6, "0")}` により同一設定での完全な再現性を保証。
7. **Batch Configuration Validation (Fail-Fast)**:
   - `matchCount <= 0`、`baseSeed = NaN`、`maxDecisionsPerMatch <= 0`、非関数ファクトリなどの設定不備は、バッチ開始前に `BatchSimulationConfigurationError` として fail-fast で reject されます。
   - 設定不備時はファクトリが一度も呼び出されず、`FAILED` 試合サマリーへ変換されることもありません。
8. **Failure Isolation (異常隔離) & Failure Reproduction Recipe**:
   - 試合実行中の例外（`SESSION_FACTORY`, `POLICY_FACTORY`, `RUNNER` フェーズ）は該当試合を `status: "FAILED"` として記録し、後続の試合を中断せずに継続完走します。
   - `BatchFailureRecord` に `baseSeed`, `matchIndex`, `matchSeed`, `playerSeeds`, エラー情報を記録し、`BatchSimulationRunner.planMatch(failure.baseSeed, failure.matchIndex)` により単独で同一 Match Plan を再構築可能です。
   - ※ 自動で再実行を行う API（`rerunFailure` 等）は未実装（MISSING / FUTURE）です。
9. **Memory Safety (Compact Result)**:
   - 全試合の生 `GameState` や `DecisionTrace`、`MatchLog` はデフォルトで保持せず破棄。大量試合でもメモリ溢れを起こさない設計。

---

## 4. Future Architecture (Phase 3.0〜4.0 予定)

### Decision DNA & Feature Encoder
```text
PlayerObservation + LegalPattern + DecisionCatalog
    ↓
FeatureEncoder (FeatureSchemaVersion: 1)
    ↓
Feature Vector (正規化された公開特徴量)
    ↓
Genome / DNA (重みベクトル / ルールウェイト)
    ↓
LegalPattern Scoring (各合法手のスコアリング)
    ↓
DecisionResponse
```

### Self-Play Evolution Cycle
1. **Population**: 100 DNA
2. **Generation Self-Play**: 各世代でトーナメントまたは総当たり戦を実施
3. **Fitness Evaluation**: 勝率、平均ターン数、ライフ残量、対戦成果に基づく適応度評価
4. **Genetic Operators**: Selection, Crossover, Mutation $\rightarrow$ 次世代生成
5. **Hall of Fame**: 歴代チャンピオン DNA、baseline AI の保存
6. **Human Match Log Learning**: 人間の Canonical Match Log から特徴量を抽出し、初期 DNA シードへ反映
