# BlackPoker Simulator AI Self-Play & Decision DNA ロードマップ

作業ID: `BP-SIM-AI-1.1.1-20260903-2311`
更新日時: 2026-09-03 23:11 JST

---

## 1. Current Capability Matrix

| Capability | Status | Existing Implementation | Test / CLI Evidence | Next Action |
|---|---|---|---|---|
| **Headless single match** | **IMPLEMENTED** | `src/engine/simulation/SimulationRunner.ts` | `src/tests/simulation/headlessSimulation.test.ts`, `playable:check`, `simulate:single` | 安定稼働中 |
| **AI Policy common interface** | **IMPLEMENTED** | `src/engine/simulation/DecisionPolicy.ts` (`DecisionPolicy`, `PolicyDescriptor`) | `src/controller/BlackPokerPolicy.ts` と統合 | DNA Policy へ拡張可能 |
| **First Legal baseline Policy** | **IMPLEMENTED** | `src/engine/simulation/DecisionPolicy.ts` (`FirstLegalPolicy`) | `src/tests/simulation/headlessSimulation.test.ts` | baseline AI として利用 |
| **Random Policy (Seeded)** | **IMPLEMENTED** | `src/engine/simulation/DecisionPolicy.ts` (`RandomPolicy`) | `src/tests/simulation/seededDeterminism.test.ts` | 決定論的ランダム対戦 |
| **Seeded RNG** | **IMPLEMENTED** | `src/engine/random/RandomSource.ts` (`SeededRandom` / Mulberry32) | `src/tests/simulation/seededDeterminism.test.ts` | PRNG 再現性保証 |
| **Deterministic re-execution** | **IMPLEMENTED** | `SimulationRunner.run` + `SeededRandom` | `src/tests/simulation/seededDeterminism.test.ts` (100% trace/hash 一致検証) | 同一入力での決定論的再実行を保証 |
| **Replay from saved data** | **MISSING** | - | - | 保存済み Trace からの再生エンジン |
| **Canonical Match Log** | **IMPLEMENTED** | `src/domain/log/CanonicalMatchLog.ts`, `src/engine/log/MatchLogRecorder.ts` | `src/tests/rules-vnext/canonicalMatchLog.test.ts`, `GameSession.getMatchLog()` | Replay / ログ解析に活用 |
| **Decision Trace v1** | **IMPLEMENTED** | `src/engine/simulation/SimulationRunner.ts` (`DecisionTraceRecord`, `decisionTraceVersion: 1`) | `src/tests/simulation/seededDeterminism.test.ts`, `simulate:single` | 意思決定・合法手 selection refs 追跡基盤確立 |
| **State Hash v2** | **IMPLEMENTED** | `src/engine/simulation/StateHasher.ts` (`stateHashVersion: 2`, 標準 FNV-1a 64-bit) | `src/tests/simulation/seededDeterminism.test.ts` | 決定論的 Logical State Fingerprint (ID/参照保持) |
| **Snapshot** | **MISSING** | - | - | Phase 1.2 で導入検討 |
| **Resume** | **MISSING** | - | - | Phase 1.2 で導入検討 |
| **Batch simulation** | **MISSING** | - | - | Phase 1.2 (10〜100試合) で導入 |
| **Failure isolation** | **MISSING** | - | - | Batch 実行時に導入 |
| **Policy versioning** | **IMPLEMENTED** | `PolicyDescriptor` (`kind`, `policyVersion`, `metadata`) | `src/engine/simulation/DecisionPolicy.ts` | Version 管理対応済み |
| **DNA format** | **MISSING** | - | - | Phase 3.0 で策定 |
| **Feature Encoder** | **MISSING** | - | - | Phase 3.0 で策定 |
| **Genome Policy** | **MISSING** | - | - | Phase 3.0 で策定 |
| **Evolution** | **MISSING** | - | - | Phase 4.0 で策定 |
| **Hall of Fame** | **MISSING** | - | - | Phase 4.0 で策定 |

---

## 2. Current Foundation (Phase 1.1.1 完了状態)

### アーキテクチャとデータフロー
```text
Game State (Raw)
    ↓
StateHasher.hash(state) ──> stateHash (sh2-...) [Decision直前の論理指紋 (ID/参照関係保持)]
    ↓
DecisionRequest (合法的公開情報・PlayerObservation・LegalPattern・DecisionCatalog)
    ↓ (生 GameState は完全遮断)
DecisionPolicy.choose(request) [SeededRandom / FirstLegal]
    ↓
DecisionResponse (selectedPatternRef)
    ↓
GameSession.submitDecision(response)
    ↓
DecisionTraceRecord (stepCount, decisionId, playerId, stateVersion, stateHash, legalPatterns(with refs), selectedPattern, policyDescriptor)
    & Canonical Match Log (実際に起きたゲームイベント)
```

### State Hash v2 仕様
- **stateHashVersion**: `2` (ハッシュ文字列プレフィックス: `sh2-...`)
- **Hash Algorithm**: 標準 64-bit FNV-1a (BigInt 実装, Offset Basis: `0xcbf29ce484222325n`, Prime: `0x100000001b3n`, 64-bit マスク)
- **Canonical Serialization**: オブジェクトキーを再帰的にアルファベット昇順ソートして正規化 JSON 文字列を生成 (`StateHasher.canonicalStringify`)
- **Deterministic Entity ID Canonicalization**:
  - 動的生成 ID (タイムスタンプを含むもの) を単一の文字列へ潰さず、決定論的な走査順 (players キー順 $\rightarrow$ 手札/ライフ/フィールド/フォグ/墓地/切札 $\rightarrow$ stage requests $\rightarrow$ requestBuffer) で連番 ID (`unit#1`, `unit#2`, `req#1`, `req#2`, `fog#1`, `card#1` 等) を割り当て。
  - エンティティ自身の ID だけでなく、`blocksUnitId`, `targetComponentId`, `targetRequestId`, `keyCards.id`, `targets` などのすべての参照先も同一の連番 canonical ID へ置換し、エンティティの個体識別と論理参照関係を完全に維持。
- **Hash 対象フィールド**:
  - 基本メタデータ: `presetId`, `turnCount`, `turnPlayer`, `chancePlayer`, `stateVersion`
  - `players`: Life (カード配列), Hand (カード配列), Field (units: componentId, kind, state, face, cards, labels, battle), Fog (fogId, componentId, card, bindings), Grave (cards/units), Trumps
  - `stageRequests`: Action processing structure (LIFO 配列順を厳格保持, id, actionId, controller, status, sequence, definitionOwner, keyCards 配列, targets, cost, selectedCostPayment, sourcePatternId)
  - `bufferRequests`: Stage とは明確に分離された保留中誘発キュー (id, actionId, controller, sequence, definitionOwner, keyCards 配列, triggerBindings, sourceEvent)
- **Hash 除外フィールド**:
  - タイムスタンプ (`Date.now()`, `timestamp`)
  - UI 状態・React 状態
  - MatchLog 内部状態
  - ランダムな UI 用 ID
  - `phase` (BlackPoker 公式ルールに Phase 概念は存在しないため完全削除)
- **v1 との非互換理由**:
  - ID 単純潰しの廃止による個体識別・参照関係の保持
  - ActionRequest 正式構造 (`keyCards` 配列) への完全適合
  - `phase` フィールドの削除

---

## 3. Next Capability (Phase 1.2 予定)

1. **Snapshot & Resume**:
   途中状態（`snapshotFormatVersion: 1`）のシリアライズ保存とセッション復元実行。
2. **Batch Simulation (Smoke 10〜100試合)**:
   複数試合の連続実行ループと勝率・ターン数等の統計サマライザー、1試合のエラーが全体を止めない Failure Isolation。

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
