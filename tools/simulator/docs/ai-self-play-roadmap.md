# BlackPoker Simulator AI Self-Play & Decision DNA ロードマップ

作業ID: `BP-SIM-AI-1.2-20260904-1813`
更新日時: 2026-09-04 18:13 JST

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
| **Replay from saved data** | **MISSING** | - | - | 保存済み Trace からの再生エンジン (将来) |
| **Canonical Match Log** | **IMPLEMENTED** | `src/domain/log/CanonicalMatchLog.ts`, `src/engine/log/MatchLogRecorder.ts` | `src/tests/rules-vnext/canonicalMatchLog.test.ts`, `GameSession.getMatchLog()` | Replay / ログ解析に活用 |
| **AI Policy / RNG Checkpoint** | **MISSING / FUTURE** | - | - | Simulation Runner レベルでの乱数状態を含むチェックポイント |
| **Batch simulation** | **MISSING** | - | - | Phase 1.3 (10〜100試合) で導入予定 |
| **Failure isolation** | **MISSING** | - | - | Batch 実行時に導入 |
| **Policy versioning** | **IMPLEMENTED** | `PolicyDescriptor` (`kind`, `policyVersion`, `metadata`) | `src/engine/simulation/DecisionPolicy.ts` | Version 管理対応済み |
| **DNA format** | **MISSING** | - | - | Phase 3.0 で策定 |
| **Feature Encoder** | **MISSING** | - | - | Phase 3.0 で策定 |
| **Genome Policy** | **MISSING** | - | - | Phase 3.0 で策定 |
| **Evolution** | **MISSING** | - | - | Phase 4.0 で策定 |
| **Hall of Fame** | **MISSING** | - | - | Phase 4.0 で策定 |

---

## 2. Current Foundation (Phase 1.2 完了状態)

### アーキテクチャとデータフロー
```text
GameSession (WAITING_FOR_DECISION などの Stable Boundary)
    ↓
session.createSnapshot() ──> GameSessionSnapshot (JSON-safe DTO, Version: 1)
    │                         ├─ metadata (matchId, rulePackageRef, rulesVersion)
    │                         ├─ gameState (Raw GameState clone)
    │                         ├─ gameStateHash ("sh2-..." State Hash v2)
    │                         ├─ session (consecutivePassCount, pendingDecision, continuation, resolvingRequest, resolvingContext)
    │                         └─ matchLog (CanonicalMatchLog prefix)
    ↓
JSON.stringify(snapshot) / JSON.parse(json) (JSON Round-Trip 保証)
    ↓
GameSession.fromSnapshot(snapshot, rulePackage) (検証: Version, 必須フィールド, State Hash 照合)
    ↓
Restored GameSession (同じ DecisionResponse を適用して Original と同一の GameState 遷移を再開)
```

### GameSession Snapshot v1 仕様
- **snapshotFormatVersion**: `1`
- **Capture 可能 Boundary**: `GameSession` のパブリックメソッドが return した後の stable boundary（特に `WAITING_FOR_DECISION` 状態）
- **JSON-safe 保証**: class instance, function, Map, Set, Symbol, cyclic reference, BigInt を含まず、`JSON.stringify` / `JSON.parse` の完全な round-trip が可能。
- **GameState Hash**: Snapshot 作成時の GameState に対して `StateHasher.hash(state)` (State Hash v2: `sh2-...`) を算出して格納。Restore 時に再計算 Hash と照合し、データの破損や改ざんを検知して reject。
- **Session State の棚卸しと再構成**:
  - `consecutivePassCount`: Snapshot へ保存し、Restore 時に `new PassTracker(count)` で復元。
  - `pendingDecision`: `DecisionRequest` (JSON-safe DTO) を Snapshot へ保存・復元し、同一 Session の `runtimeDecisionId` を維持。
  - `continuation`: `EffectContinuation` (JSON-safe DTO) を保存・復元。
  - `resolvingRequest`: JSON-safe DTO として保存し、Restore 時に GameState 内のリクエスト参照を優先して再バインド（`action` 定義は RulePackage から再バインド）。
  - `resolvingContext`: runtime object (registry, logRecorder) は除外した DTO として保存し、Restore 時に新しい GameSession の runtime インスタンスから安全に再構築。
  - `matchStartedRecorded`, `lastRecordedTurnPlayer`: 内部フラグとして保存・復元。
- **Rule Package**: Snapshot にルール定義全体は含めず外部依存とし、Restore 時に `RulePackage` を渡して `metadata` と整合性を確認。
- **Full / Privileged Data Artifact**: Snapshot は GameState の完全復元を目的とするため、相手手札や伏せ防壁などの非公開情報を含む。ただし、**Snapshot は AI Policy 入力境界ではなく、Public Observation でもない**。AI Policy への入力は引き続き `DecisionRequest`（マスクされた PlayerObservation）のみに限定。
- **MatchLog Continuation**: Snapshot 前の `CanonicalMatchLog` を prefix として完全保持し、Restore 後の初回 `advance()` で `match.started` を重複記録せず、新規イベントを単調増加する `seq` で正常に追記。
- **Branching (What-if)**: 1 つの Snapshot から複数の独立した `GameSession` を復元し、それぞれ異なる意思決定を行って状態を分岐可能。

### GameSession Snapshot と AI Policy Checkpoint / Replay Engine の違い
- **GameSession Snapshot**: ゲーム進行（ルールエンジン・セッション状態）の途中保存・再開を行う DTO。
- **AI Policy / RNG Checkpoint (MISSING / FUTURE)**: RandomPolicy などの AI 内部乱数状態（PRNG position）や SimulationRunner のトレース蓄積を含むチェックポイント。
- **Replay Engine (MISSING / FUTURE)**: 保存済み Decision Trace を初期状態から順次適用して試合をリプレイ再生する機構。
- **Snapshot Resume ≠ Replay from saved trace**: Snapshot Resume は「保存された Session State からの直接再開」であり、最初からのリプレイ再生ではありません。

---

## 3. Next Capability: Batch Simulation & Failure Isolation (Phase 1.3 予定)

Match Snapshot & Resume 基盤が確立されたため、多数の対戦（10〜100試合）を安定して自動実行し、勝率・ターン数・エラー発生率などの統計を収集する Batch Simulation 基盤へ進みます。

### 主要要件
1. **Batch Runner**: N 試合（例: 50〜100 試合）を連続実行するヘッドレスランナー
2. **Failure Isolation**: 単一試合でのエラー（タイムアウト、例外）が発生してもプロセス全体をクラッシュさせず、失敗としてログ記録して次の試合を継続
3. **Statistical Aggregator**: 勝率、平均ターン数、引き分け数、勝因（ライフ枯渇、投了等）、平均意思決定回数の集計レポート出力

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
