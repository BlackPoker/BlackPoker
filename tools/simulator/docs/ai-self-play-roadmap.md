# BlackPoker Simulator AI Self-Play & Decision DNA ロードマップ

作業ID: `BP-SIM-AI-1.0-20260903-0029`  
更新日時: 2026-09-03 00:29 JST  

---

## 1. Current Capability Matrix

| Capability | Status | Existing Implementation | Test / CLI Evidence | Next Action |
|---|---|---|---|---|
| **Headless single match** | **IMPLEMENTED** | `src/engine/simulation/SimulationRunner.ts` | `src/tests/simulation/headlessSimulation.test.ts`, `playable:check`, `simulate:single` | 安定稼働中 |
| **AI Policy common interface** | **IMPLEMENTED** | `src/engine/simulation/DecisionPolicy.ts` (`DecisionPolicy`, `PolicyDescriptor`) | `src/controller/BlackPokerPolicy.ts` と統合 | DNA Policy へ拡張可能 |
| **First Legal baseline Policy** | **IMPLEMENTED** | `src/engine/simulation/DecisionPolicy.ts` (`FirstLegalPolicy`) | `src/tests/simulation/headlessSimulation.test.ts` | baseline AI として利用 |
| **Random Policy (Seeded)** | **IMPLEMENTED** | `src/engine/simulation/DecisionPolicy.ts` (`RandomPolicy`) | `src/tests/simulation/seededDeterminism.test.ts` | 決定論的ランダム対戦 |
| **Seeded RNG** | **IMPLEMENTED** | `src/engine/random/RandomSource.ts` (`SeededRandom` / Mulberry32) | `src/tests/simulation/seededDeterminism.test.ts` | PRNG 再現性保証 |
| **Deterministic replay** | **IMPLEMENTED** | `SimulationRunner.run` + `SeededRandom` | `src/tests/simulation/seededDeterminism.test.ts` (100% trace 一致検証) | 決定論的再現を保証 |
| **Canonical Match Log** | **IMPLEMENTED** | `src/domain/log/CanonicalMatchLog.ts`, `src/engine/log/MatchLogRecorder.ts` | `src/tests/rules-vnext/canonicalMatchLog.test.ts`, `GameSession.getMatchLog()` | Replay / ログ解析に活用 |
| **Decision Trace** | **IMPLEMENTED (Base)** | `src/engine/simulation/SimulationRunner.ts` (`SimulationStepRecord`) | `src/tests/simulation/seededDeterminism.test.ts` | 将来 JSON エクスポートへ拡張 |
| **State Hash** | **MISSING** | - | - | Phase 2.0 で導入検討 |
| **Snapshot** | **MISSING** | - | - | Phase 2.0 で導入検討 |
| **Resume** | **MISSING** | - | - | Phase 2.0 で導入検討 |
| **Batch simulation** | **MISSING** | - | - | Phase 2.0 (10〜100試合) で導入 |
| **Failure isolation** | **MISSING** | - | - | Batch 実行時に導入 |
| **Policy versioning** | **IMPLEMENTED** | `PolicyDescriptor` (`kind`, `policyVersion`, `metadata`) | `src/engine/simulation/DecisionPolicy.ts` | Version 管理対応済み |
| **DNA format** | **MISSING** | - | - | Phase 3.0 で策定 |
| **Feature Encoder** | **MISSING** | - | - | Phase 3.0 で策定 |
| **Genome Policy** | **MISSING** | - | - | Phase 3.0 で策定 |
| **Evolution** | **MISSING** | - | - | Phase 4.0 で策定 |
| **Hall of Fame** | **MISSING** | - | - | Phase 4.0 で策定 |

---

## 2. Current Foundation (Phase 1.0 完了状態)

### アーキテクチャとデータフロー
```text
Game State (Raw)
    ↓
DecisionRequest (合法的公開情報・PlayerObservation・LegalPattern・DecisionCatalog)
    ↓ (生 GameState は完全遮断)
DecisionPolicy.choose(request) [SeededRandom / FirstLegal]
    ↓
DecisionResponse (selectedPatternRef)
    ↓
GameSession.submitDecision(response)
    ↓
SimulationStepRecord (Decision Trace) & Canonical Match Log
```

- **秘密情報境界の厳格維持**:
  AI Policy は `DecisionRequest` のみを受け取ります。生 `GameState` へのアクセス経路はなく、相手の非公開情報（Life 10以上時の正確な枚数、相手手札、相手伏せ防壁）は `PlayerObservation` 境界で完全に秘匿・HIDDEN 化されています。
- **決定論的再現性 (Determinism)**:
  `SeededRandom` (Mulberry32 PRNG) を用いることで、同一 seed・同一初期盤面・同一 Policy によるシミュレーションは 100% 同一の `DecisionTrace`、勝敗、最終盤面を再現します。

---

## 3. Next Capability (Phase 2.0 予定)

1. **State Hash**:
   論理ゲーム状態の決定論的ハッシュ関数。
2. **Snapshot & Resume**:
   途中状態（`snapshotFormatVersion: 1`）の保存と復元実行。
3. **Batch Simulation (Smoke 10〜100試合)**:
   複数試合の連続実行と勝率統計、1試合のエラーが全体を止めない Failure Isolation。

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
