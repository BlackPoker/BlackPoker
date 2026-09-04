# BlackPoker Simulator AI Self-Play & Decision DNA ロードマップ

作業ID: `BP-SIM-AI-1.3-20260904-2101`
更新日時: 2026-09-04 21:01 JST

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
| **Batch simulation** | **IMPLEMENTED** | `src/engine/simulation/BatchSimulationRunner.ts`, `src/domain/simulation/BatchSimulationTypes.ts` | `src/tests/simulation/batchSimulation.test.ts`, `npm run simulate:batch` | 決定論的バッチ対戦・集計基盤 |
| **Failure isolation** | **IMPLEMENTED** | `BatchSimulationRunner.ts` (`BatchFailureRecord`, `stopOnError: false`) | `src/tests/simulation/batchSimulation.test.ts` | 異常試合の隔離とバッチ継続完走 |
| **Deterministic Seed Derivation** | **IMPLEMENTED** | `BatchSimulationRunner.deriveSeed` (FNV-1a 32-bit 純粋関数) | `src/tests/simulation/batchSimulation.test.ts` | 実行順序非依存・単独再現性保証 |
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

## 3. Batch Simulation & Failure Isolation Foundation (Phase 1.3 完了状態)

### アーキテクチャとデータフロー
```text
BatchSimulationRunner.run(options)
    │
    ├─ for matchIndex = 0 .. matchCount - 1:
    │     │
    │     ├─ planMatch(baseSeed, matchIndex)
    │     │     ├─ matchSeed = deriveSeed(baseSeed, matchIndex, "match")
    │     │     ├─ p1Seed    = deriveSeed(baseSeed, matchIndex, "p1")
    │     │     └─ p2Seed    = deriveSeed(baseSeed, matchIndex, "p2")
    │     │
    │     ├─ try {
    │     │     session  = options.sessionFactory(context)   // fresh instance
    │     │     policies = options.policyFactory(context)    // fresh instance with derived seeds
    │     │     result   = SimulationRunner.run(session, policies, { maxDecisions })
    │     │  } catch (err) {
    │     │     record BatchFailureRecord (phase, error, seeds)
    │     │     continue next match (Failure Isolation)
    │     │  }
    │     │
    │     └─ compact BatchMatchResult (COMPLETED | INCOMPLETE | FAILED)
    │
    └─ calculateSummary() ──> BatchSimulationResult (batchResultVersion: 1)
```

### 主要設計仕様
1. **batchResultVersion**: `1`
2. **純粋関数 Seed 導出 (`deriveSeed`)**:
   - `deriveSeed(baseSeed, matchIndex, streamKey)`: FNV-1a 32-bit アルゴリズムによる純粋関数。
   - 他の試合の実行有無や実行順序に一切依存せず、Match #N のシードを単独で一意算出可能。
3. **決定論的 Match ID**:
   - `batch-${baseSeed}-match-${String(matchIndex).padStart(6, "0")}` により同一設定での完全な再現性を保証。
4. **Failure Isolation**:
   - `sessionFactory`, `policyFactory`, `SimulationRunner.run` のいずれのフェーズで例外が発生しても、該当試合を `status: "FAILED"` として記録し、後続の試合を中断せずに継続実行。
   - `BatchFailureRecord` に発生フェーズ、エラー名、メッセージ、シード情報を保持し、単独再現を可能に。
5. **Memory Safety (Compact Result)**:
   - 全試合の生 `GameState` や `DecisionTrace`、`MatchLog` はデフォルトで保持せず破棄。
   - 勝敗、ターン数、判断数、State Hash v2 のみを集約し、大量試合（100〜1,000+試合）でもメモリ溢れを起こさない設計。
6. **統計サマリー集約**:
   - 総試合数、完了数、未完了数、失敗数、プレイヤー別勝率、引き分け数、平均ターン数、平均意思決定数、総実行時間を即時算出。

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
