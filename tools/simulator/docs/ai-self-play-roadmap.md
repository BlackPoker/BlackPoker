# BlackPoker Simulator AI Self-Play & Decision DNA ロードマップ

作業ID: `BP-SIM-AI-REQUEST-CONDITIONED-SELECTION-V1`
更新日時: 2026-10-12 03:00 JST

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
| **Logical Pattern Key** | **IMPLEMENTED** | `src/domain/decision/LogicalPatternKey.ts` | `src/tests/simulation/seededDeterminism.test.ts`, `DecisionFeatureEncoder` | 意味論的合法手一意識別 |
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
| **Master + Extra Generic Compatibility** | **IMPLEMENTED** | Action / Component 非依存な抽象インターフェース設計 | `BatchSimulationRunner.ts`, `DecisionFeatureEncoder.ts` | 拡張DSL追加での改修不要 |
| **Failure Reproduction Recipe** | **IMPLEMENTED** | `BatchFailureRecord` (`baseSeed`, `matchIndex`, `matchSeed`, `playerSeeds`) | `src/tests/simulation/batchSimulation.test.ts` | 失敗試合の同一プラン再構築保証 |
| **Decision Feature Schema v1** | **SUPERSEDED** | `featureSchemaVersion: 1` | `src/tests/ai/decisionFeatureEncoder.test.ts` (初期プロトタイプ) | Context 25, Pattern 57 (計 1482 weights) |
| **Decision Feature Schema v2** | **SUPERSEDED BY FEATURE SCHEMA v3** | `src/domain/ai/DecisionFeatureTypes.ts` (`featureSchemaVersion: 2`) | `src/tests/ai/decisionFeatureEncoder.test.ts`, `decisionFeaturePrivacyV2.test.ts` | 固定次元・順序保証（Context 100次元, Pattern 60次元, 合計 6060次元） |
| **Decision Feature Schema v3** | **IMPLEMENTED / PENDING INDEPENDENT REVIEW** | `src/domain/ai/DecisionFeatureTypes.ts` (`featureSchemaVersion: 3`) | `src/tests/ai/decisionFeatureEncoder.test.ts`, `decisionFeatureDownUpScorer.test.ts`, `decisionFeatureEffectSelectionRegression.test.ts` | Request-Conditioned Generic Selection (Context 163次元, Pattern 111次元, 合計 18204 weights) |
| **Generic Feature Encoder v3** | **IMPLEMENTED / PENDING INDEPENDENT REVIEW** | `src/engine/ai/DecisionFeatureEncoder.ts` | `src/tests/ai/decisionFeatureEncoder.test.ts` | Request Context (Action multi-hash 16, EffectStep multi-hash 16, metadata, key cards) + Generic Selection (Unit, Card, Assignment, Player, Ratio) |
| **Viewer-relative Encoding** | **IMPLEMENTED / PENDING INDEPENDENT REVIEW** | `DecisionFeatureEncoder` (`self` vs `opponent`) | `src/tests/ai/decisionFeatureEncoder.test.ts` | 座席非依存・鏡像対称性保証 |
| **Secret-safe Feature Encoding** | **IMPLEMENTED / PENDING INDEPENDENT REVIEW** | `DecisionFeatureEncoder` (相手Life 10+、伏せカード秘匿、相手裏向き切札/防壁秘匿、未開封パック中身秘匿) | `src/tests/ai/decisionFeaturePrivacyV2.test.ts`, `decisionFeatureObservationPrivacyV2.test.ts` | 秘密情報・表示文字列・実行時ID完全遮断 |
| **Decision DNA v1 format (v3 Schema Compatible)** | **IMPLEMENTED / PENDING INDEPENDENT REVIEW** | `src/domain/ai/DecisionDNATypes.ts`, `src/engine/ai/DecisionDNACodec.ts` | `src/tests/ai/decisionDNA.test.ts` | 18204次元 (Pattern 111, Interaction 18093), 旧 v1/v2 DNA は fail-closed 拒絶 |
| **Standard + Pack Target Foundation** | **IMPLEMENTED / PENDING INDEPENDENT REVIEW** | `src/engine/regulation/OfficialRegulationMatchSetup.ts` | `src/tests/ai/standardPackGenomeE2E.test.ts` | official:standard-pack での Genome 対戦・決定論・Pack観測・turnCount進行 E2E 完走 |
| **DNA JSON Artifact Contract** | **IMPLEMENTED** | `src/domain/ai/DecisionDNATypes.ts`, `src/engine/ai/DecisionDNACodec.ts` | `src/tests/ai/decisionDNA.test.ts` | JSONValue型、有限数、プレーンJSONオブジェクト保証 |
| **Recursive Metadata Validation** | **IMPLEMENTED** | `DecisionDNACodec.validateMetadata` | `src/tests/ai/decisionDNA.test.ts` | 非有限数、BigInt、関数、Symbol、Date、Map、Set、循環参照拒絶 |
| **Factory Entry Validation** | **IMPLEMENTED** | `DecisionDNACodec.createZeroDecisionDNA` | `src/tests/ai/decisionDNA.test.ts` | clone 前先行 validation、truthy 判定廃止、null/array/cycle 安全拒絶 |
| **Deep Clone Isolation** | **IMPLEMENTED** | `DecisionDNACodec.clone`, `GenomePolicy` | `src/tests/ai/decisionDNA.test.ts`, `src/tests/ai/genomePolicy.test.ts` | nested metadata / arrays の参照共有完全排除 |
| **Genome Policy** | **IMPLEMENTED** | `src/engine/ai/GenomePolicy.ts`, `src/engine/ai/GenomeScorer.ts` | `src/tests/ai/genomePolicy.test.ts` | 決定論的 Argmax + 最小 patternRef タイブレーク |
| **Policy Experiment Harness** | **IMPLEMENTED** | `src/engine/ai/PolicyExperimentRunner.ts`, `src/domain/ai/PolicyExperimentTypes.ts` | `src/tests/ai/policyExperiment.test.ts`, `simulate:experiment` | Pairwise 対戦実験・評価基盤 |
| **Seat-Swapped Evaluation** | **IMPLEMENTED** | `PolicyExperimentRunner.ts` (Leg 1 / Leg 2 同一 baseSeed 実行) | `src/tests/ai/policyExperiment.test.ts` | 先攻・後攻バイアスの完全分離 |
| **Deterministic Paired Match Plan** | **IMPLEMENTED** | `BatchSimulationRunner.planMatch` 再利用 (同一 matchIndex seed 一致) | `src/tests/ai/policyExperiment.test.ts` | 各 Leg の matchSeed / playerSeeds 完全一致 |
| **Participant Outcome Summary** | **IMPLEMENTED** | `PolicyExperimentRunner.ts` | `src/tests/ai/policyExperiment.test.ts` | 保存則、asP1/asP2、winRateOnCompleted |
| **Generic Behavior Metrics** | **IMPLEMENTED** | `src/engine/ai/DecisionBehaviorObserverPolicy.ts` | `src/tests/ai/policyExperiment.test.ts` | 外部 Accumulator、Pattern Kind / Source 集計 |
| **Baseline Policy Suite** | **IMPLEMENTED** | `src/engine/ai/BaselinePolicies.ts` | `src/tests/ai/policyExperiment.test.ts`, `simulate:experiment` | FirstLegal, Random, Zero, ManualGeneric |
| **Official Regulation Environment** | **IMPLEMENTED (Light + Entry16)** | `src/engine/regulation/OfficialRegulationMatchFactory.ts` | `src/tests/regulation/*.test.ts`, `npm run simulate:official` | 公式ルール第9.1.2版に基づく公式対戦環境。CORE-BATTLE 結果は公式評価ではなく Core 検証用 |
| **Official Baseline Measurement** | **IMPLEMENTED** | `src/engine/regulation/OfficialBaselineMeasurementRunner.ts` | `src/tests/ai/officialBaselineMeasurement.test.ts`, `npm run measure:official-baseline` | 公式Light+Entry16での600戦定量計測基盤 (Phase 3.3) |
| **Official Setup Viability Audit** | **IMPLEMENTED** | `src/engine/regulation/OfficialSetupAuditor.ts` | `src/tests/ai/officialBaselineMeasurement.test.ts` | 大量シードでの公式セットアップ成立監査 (100 Seeds) |
| **Feature Collision Diagnostics** | **IMPLEMENTED** | `src/engine/ai/DecisionFeatureDiagnosticObserver.ts` | `src/tests/ai/officialBaselineMeasurement.test.ts` | 同一Pattern特徴量ベクトル衝突の透明な検出・集計（動的次元参照） |
| **Feature Activation Coverage** | **IMPLEMENTED** | `src/engine/ai/DecisionFeatureDiagnosticObserver.ts` | `src/tests/ai/officialBaselineMeasurement.test.ts` | Context / Pattern 特徴量の実戦活性化率集計（動的次元参照） |
| **Genome Argmax Tie Diagnostics** | **IMPLEMENTED** | `src/engine/ai/DecisionFeatureDiagnosticObserver.ts` | `src/tests/ai/officialBaselineMeasurement.test.ts` | GenomeScorer による最善手タイ発生率の集計 |
| **Baseline Repeatability** | **IMPLEMENTED** | `src/engine/ai/OfficialBaselineMeasurementRunner.ts` | `src/tests/ai/officialBaselineMeasurement.test.ts` | Run A == Run B による 100% 論理ダイジェスト一致検証 |
| **Composite Fitness** | **MISSING / FUTURE** | - | - | 単一スコア評価・適応度関数 (Phase 4.0 で策定) |
| **Automatic Failure Re-run** | **MISSING / FUTURE** | - | - | 失敗試合の自動再実行API (将来) |
| **Parallel Batch** | **MISSING / FUTURE** | - | - | Worker thread / マルチプロセス並列実行 (将来) |
| **Replay from saved data** | **MISSING** | - | - | 保存済み Trace からの再生エンジン (将来) |
| **Canonical Match Log** | **IMPLEMENTED** | `src/domain/log/CanonicalMatchLog.ts`, `src/engine/log/MatchLogRecorder.ts` | `src/tests/rules-vnext/canonicalMatchLog.test.ts`, `GameSession.getMatchLog()` | Replay / ログ解析に活用 |
| **AI Policy / RNG Checkpoint** | **MISSING / FUTURE** | - | - | Simulation Runner レベルでの乱数状態を含むチェックポイント |
| **Policy versioning** | **IMPLEMENTED** | `PolicyDescriptor` (`kind`, `policyVersion`, `metadata`) | `src/engine/simulation/DecisionPolicy.ts` | Version 管理対応済み |
| **Evolution** | **MISSING / FUTURE** | - | - | Phase 4.0 で策定 |
| **Hall of Fame** | **MISSING / FUTURE** | - | - | Phase 4.0 で策定 |

---

## 2. Feature Coverage Table (13 カテゴリ)

| カテゴリ | カバレッジステータス | 説明・実装実態 |
|---|---|---|
| **1. Board Context** | **FULL** | 盤面全体、ターン進行、ライフ、手札統計、フィールドユニット、フォグ、切札、墓地、パック、レア、相対差分（100次元） |
| **2. Request Source** | **FULL** | `request_has_source`, `is_action`, `is_effect`, `is_zone_top`, コントローラー相対関係 (self/opponent) (6次元) |
| **3. Source Action Identity** | **FULL** | `StableIdentityEncoder` による固定長 16 バケット multi-hash (FNV-1a + Murmur3 fmix 3-hash 方式、現行37種無衝突) |
| **4. Effect Step Identity** | **FULL** | `StableIdentityEncoder` による固定長 16 バケット multi-hash (主要ステップ無衝突) |
| **5. Source Request Semantics** | **FULL** | speed (normal/immediate/other), timing (main/quick/block/damage_judge/other), visible key-card aggregate (count, known, value sum/max/min), target semantics (25次元) |
| **6. Target Selection** | **FULL** | targetType (player/unit/request/none/other), targetOwner (self/opponent), target unit size, charge, drive, face up/down (13次元) |
| **7. Key Card / Key Unit** | **FULL** | key card (count, known, values, suits), key unit (count, size sum/max, charge, drive, face) (19次元) |
| **8. Effect Unit Selection** | **FULL** | unit count, self/opp count, charge, drive, face up/down, size sum/max/min, attacker, blocker (12次元) |
| **9. Effect Card Selection** | **FULL** | `KnownCardAggregateEncoder` 再利用による card count, known count, suits, ranks, value sum/max/min, pair, multiplicity (17次元) |
| **10. Unit Assignment** | **FULL** | source/selected count, source/selected size sum/max/min, size delta sum, positive/negative delta count, self->opp, opp->self (13次元) |
| **11. Selection Coverage Ratio** | **FULL** | candidate count, selected count, coverage ratio (3次元) |
| **12. Order Selection** | **PARTIAL** | `has_order_selection`, `ordered_item_count` (2次元)。複雑な順序特徴量は安定性のため将来拡張 |
| **13. Effect Result Context** | **DEFERRED** | 現シミュレータでは sourceAction / effectStep / board observation で判断局面を100%一意に識別可能なため未導入。多段階複合効果の途中事実が必要になった段階で設計 |
| **14. Privacy Boundary** | **FULL** | 相手手札中身、相手伏せ防壁/切札、未公開サイズ、未開封パック中身、相手Life 10+ を完全秘匿 |

---

## 3. Decision Feature Schema v3 & Request-Conditioned Scoring (Phase 3.0 / 3.1)

### アーキテクチャとデータフロー
```text
DecisionRequest (合法的AI入力境界: observation + catalog + patterns + source)
    ↓
DecisionFeatureEncoder.encode(request)
    │
    ├─ Context Features (163次元, Viewer-Relative, Secret-Safe)
    │     ├─ Decision Context (8次元)
    │     ├─ Legal Pattern Counts (11次元)
    │     ├─ Self Public State: Hand / Field / Grave / Pack / Rare / Fog / Trump (45次元)
    │     ├─ Opponent Public State (26次元)
    │     ├─ Relative State (10次元)
    │     └─ Request Context (63次元)
    │           ├─ Source Existence & Controller Relation (6次元)
    │           ├─ Source Action Stable Identity (16 buckets)
    │           ├─ Source Effect Step Stable Identity (16 buckets)
    │           ├─ Source Action Metadata: Speed & Timing (8次元)
    │           ├─ Source Key Cards Aggregate (5次元)
    │           └─ Source Target Semantics (12次元)
    │
    └─ Pattern Features (各パターン 111次元, Generic Traits)
          ├─ Pattern Kind (4次元)
          ├─ Action Metadata (9次元)
          ├─ Cost Payment (6次元)
          ├─ Key Card (11次元)
          ├─ Key Unit (8次元)
          ├─ Target (13次元)
          ├─ Effect Selection Base Metadata (7次元)
          ├─ Generic Effect Unit Selection (12次元)
          ├─ Generic Effect Card Selection (17次元)
          ├─ Generic Effect Player / Request (6次元)
          ├─ Generic Effect Unit Assignment (13次元)
          ├─ Selection Coverage Ratio (3次元)
          └─ Order Selection (2次元)
    ↓
EncodedDecisionFeatures (featureSchemaVersion: 3, JSON-Safe, Finite Numbers)
    ↓
GenomeScorer (Pure Functional / Stateless)
    score(p) = Σ w_j * p_j + Σ Σ M_ij * c_i * p_j
    (Pattern Weights: 111次元 + Context-Pattern Interaction Weights: 163 * 111 = 18093次元 = 計 18204 重み)
    ↓
Deterministic Argmax Selection (タイブレーク: 最小 patternRef)
```

### Request-Conditioned Scoring の設計根拠 (Down vs Up)
従来の Feature Schema v2 では「何個選んだか」「選んだユニットのサイズ」は観測できたものの、「どの Action や Request の効果として選んでいるか」が弱かったため、例えば：
- Down でサイズ8の兵士を選ぶ（裏向き配置）
- Up でサイズ8の兵士を選ぶ（表向き配置）
という全く異なる判断が同一盤面で同一の重み評価を受ける制約がありました。

Feature Schema v3 では、Request Context に `request_action_bucket_*` および `request_effect_step_bucket_*` を導入したことにより：
- Down リクエスト $\times$ サイズ8の選択
- Up リクエスト $\times$ サイズ8の選択
が異なる Context $\times$ Pattern 相互作用重み ($M_{ij}$) を持つことが可能となり、DNA が「Down では小型、Up では大型」を自然に学習・差別化できるようになりました（`decisionFeatureDownUpScorer.test.ts` にて Scorer レベルで直接証明済み）。

Action ID や Effect Step ID に対する個別 one-hot カラムや手動 if 分岐は一切導入せず、固定長 multi-hash (StableIdentityEncoder) と汎用メタデータによって表現されているため、将来 Master や Extra で新アクションが追加されても Feature Schema の変更や DNA の次元数変更は不要です。

---

## 4. Privacy & Versioning Contract

1. **Privacy Contract**:
   - `DecisionFeatureEncoder` の入力は `Readonly<DecisionRequest>` のみ。
   - `GameState`, `GameSession`, `Snapshot`, `RulePackage` への直接アクセス・裏口参照は厳禁。
   - 相手手札の非公開カード、相手伏せ防壁/切札、相手裏向きユニットの `currentSize`、相手Life 10枚以上時の正確な枚数、未開封パックの中身は完全に秘匿。
   - 実行時動的 ID (`decisionId`, `matchId`, `opaqueCardId`, `cardInstanceId`, `unitId` 等の文字列) や表示用文字列 (`player.name`, `actionName`, `displayName`, `summary`) は特徴量値として使用禁止。
   - すべての特徴量値は有限数値 (`Number.isFinite(v) === true`)。
2. **Versioning & Fail-Closed Contract**:
   - `FEATURE_SCHEMA_VERSION = 3`, `DNA_FORMAT_VERSION = 1`, `scoringModel: "linear-bilinear-v1"`。
   - 旧 v1 DNA (`featureSchemaVersion: 1`) および 旧 v2 DNA (`featureSchemaVersion: 2`) は、暗黙の zero padding やマイグレーションを行わず、`DecisionDNAValidationError` により **Fail-Closed で拒絶** されます。
3. **Master + Extra 互換原則**:
   - 特定の Action ID に対する手動ルール（`if (actionId === "action.down")` 等）は一切使用しません。
   - 新規 Action や Trump 追加時も、`StableIdentityEncoder` の固定長 multi-bucket hashing によりスキーマ変更不要で即座に観測・学習可能です（`action.synthetic.alpha/beta` による実証済み）。

---

## 5. Future Architecture (Phase 4.0 予定)

### Self-Play Evolution Cycle (BP-SIM-AI-EVOLUTION-V1 予定)
1. **Population**: 100 DNA
2. **Generation Self-Play**: `BatchSimulationRunner` および `PolicyExperimentRunner` を用いた世代内評価
3. **Fitness Evaluation**: 勝率、平均ターン数、ライフ残量、対戦成果に基づく適応度評価
4. **Genetic Operators**: Selection, Crossover, Mutation $\rightarrow$ 次世代生成
5. **Hall of Fame**: 歴代チャンピオン DNA、baseline AI の保存
6. **Human Match Log Learning**: 人間の Canonical Match Log から特徴量を抽出し、初期 DNA シードへ反映
