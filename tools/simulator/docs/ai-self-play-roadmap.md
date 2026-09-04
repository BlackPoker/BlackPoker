# BlackPoker Simulator AI Self-Play & Decision DNA ロードマップ

作業ID: `BP-SIM-AI-3.1.2-20260905-0638`
更新日時: 2026-09-05 06:38 JST

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
| **Decision Feature Schema v1** | **IMPLEMENTED** | `src/domain/ai/DecisionFeatureTypes.ts` (`featureSchemaVersion: 1`) | `src/tests/ai/decisionFeatureEncoder.test.ts` | 固定次元・順序保証（Context 25次元, Pattern 57次元） |
| **Generic Feature Encoder v1** | **IMPLEMENTED** | `src/engine/ai/DecisionFeatureEncoder.ts` | `src/tests/ai/decisionFeatureEncoder.test.ts` | DecisionRequest のみを入力とする決定論的エンコーダー |
| **Viewer-relative Encoding** | **IMPLEMENTED** | `DecisionFeatureEncoder` (`self` vs `opponent`) | `src/tests/ai/decisionFeatureEncoder.test.ts` | 座席非依存・鏡像対称性保証 |
| **Secret-safe Feature Encoding** | **IMPLEMENTED** | `DecisionFeatureEncoder` (相手Life 10+、伏せカード秘匿) | `src/tests/ai/decisionFeatureEncoder.test.ts` | 秘密情報・表示文字列・実行時ID完全遮断 |
| **Decision DNA v1 format** | **IMPLEMENTED** | `src/domain/ai/DecisionDNATypes.ts`, `src/engine/ai/DecisionDNACodec.ts` | `src/tests/ai/decisionDNA.test.ts` | 1482次元 (Context 25, Pattern 57, Inter 1425) |
| **DNA JSON Artifact Contract** | **IMPLEMENTED** | `src/domain/ai/DecisionDNATypes.ts`, `src/engine/ai/DecisionDNACodec.ts` | `src/tests/ai/decisionDNA.test.ts` | JSONValue型、有限数、プレーンJSONオブジェクト保証 |
| **Recursive Metadata Validation** | **IMPLEMENTED** | `DecisionDNACodec.validateMetadata` | `src/tests/ai/decisionDNA.test.ts` | 非有限数、BigInt、関数、Symbol、Date、Map、Set、循環参照拒絶 |
| **Factory Entry Validation** | **IMPLEMENTED** | `DecisionDNACodec.createZeroDecisionDNA` | `src/tests/ai/decisionDNA.test.ts` | clone 前先行 validation、truthy 判定廃止、null/array/cycle 安全拒絶 |
| **Deep Clone Isolation** | **IMPLEMENTED** | `DecisionDNACodec.clone`, `GenomePolicy` | `src/tests/ai/decisionDNA.test.ts`, `src/tests/ai/genomePolicy.test.ts` | nested metadata / arrays の参照共有完全排除 |
| **Genome Policy** | **IMPLEMENTED** | `src/engine/ai/GenomePolicy.ts`, `src/engine/ai/GenomeScorer.ts` | `src/tests/ai/genomePolicy.test.ts` | 決定論的 Argmax + 最小 patternRef タイブレーク |
| **Automatic Failure Re-run** | **MISSING / FUTURE** | - | - | 失敗試合の自動再実行API (将来) |
| **Parallel Batch** | **MISSING / FUTURE** | - | - | Worker thread / マルチプロセス並列実行 (将来) |
| **Replay from saved data** | **MISSING** | - | - | 保存済み Trace からの再生エンジン (将来) |
| **Canonical Match Log** | **IMPLEMENTED** | `src/domain/log/CanonicalMatchLog.ts`, `src/engine/log/MatchLogRecorder.ts` | `src/tests/rules-vnext/canonicalMatchLog.test.ts`, `GameSession.getMatchLog()` | Replay / ログ解析に活用 |
| **AI Policy / RNG Checkpoint** | **MISSING / FUTURE** | - | - | Simulation Runner レベルでの乱数状態を含むチェックポイント |
| **Policy versioning** | **IMPLEMENTED** | `PolicyDescriptor` (`kind`, `policyVersion`, `metadata`) | `src/engine/simulation/DecisionPolicy.ts` | Version 管理対応済み |
| **Evolution** | **MISSING** | - | - | Phase 4.0 で策定 |
| **Hall of Fame** | **MISSING** | - | - | Phase 4.0 で策定 |

---

## 2. Match Snapshot & Resume Foundation (Phase 1.2.1)

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

## 3. Batch Simulation & Failure Isolation Foundation (Phase 1.3 / 1.3.1)

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

---

## 4. Decision Feature Contract v1 & Generic Feature Encoder (Phase 3.0 / Phase 3.0.1 完了状態)

AI の実装安全性を高めるため、Phase 3.0 ではまず Feature Contract / Generic Encoder を確立し、DNA 形式・Genome Policy の実装を Phase 3.1 へ分離しました。さらに Phase 3.0.1 において視点対称性、実 Core 連携、ID 不変性の検証保証を補強しました。

### アーキテクチャとデータフロー
```text
DecisionRequest (合法的AI入力境界: observation + catalog + patterns)
    ↓
DecisionFeatureEncoder.encode(request)
    │
    ├─ Context Features (25次元, Viewer-Relative, Secret-Safe)
    │     ├─ Decision Source (ACTION_REQUEST / EFFECT_RESOLUTION)
    │     ├─ Turn / Chance Relative Roles (self / opponent)
    │     ├─ Stage Depth
    │     ├─ Legal Pattern Counts (total, action, pass, effect)
    │     ├─ Self Public State (life, hand, field, fog, trump, grave)
    │     └─ Opponent Public State (life visible/is10plus, hand, field, fog, trump, grave)
    │
    └─ Pattern Features (各パターン 57次元, Generic Traits)
          ├─ Pattern Kind (action, pass, effect_selection, other)
          ├─ Action Metadata (speed: normal/immediate/other, timing: main/quick/block/damage_judge/other)
          ├─ Cost Payment (discard count, bulwark count, sacrifice count, life count)
          ├─ Key Card (count, known count, value sum, value max, spade/heart/diamond/club count)
          ├─ Key Unit (count, size sum, size max, charge/drive, face up/down)
          ├─ Target (player/unit/request/none, self/opponent, target unit size/state/face)
          ├─ Effect Selection (unit/assignment/other, value count, assignment count, unit total)
          └─ Order Selection (ordered item count)
    ↓
EncodedDecisionFeatures (featureSchemaVersion: 1, JSON-Safe, Finite Numbers)
```

### Feature Schema v1 定義一覧

#### Context Feature Names (25次元)
1. `source_is_action_request`
2. `source_is_effect_resolution`
3. `self_is_turn_player`
4. `self_is_chance_player`
5. `opponent_is_turn_player`
6. `opponent_is_chance_player`
7. `stage_depth`
8. `legal_pattern_count`
9. `legal_action_pattern_count`
10. `legal_pass_pattern_count`
11. `legal_effect_selection_pattern_count`
12. `self_life_count`
13. `self_hand_count`
14. `self_field_count`
15. `self_fog_count`
16. `self_trump_count`
17. `self_grave_count`
18. `opponent_life_known`
19. `opponent_life_visible_count`
20. `opponent_life_is_10plus`
21. `opponent_hand_count`
22. `opponent_field_count`
23. `opponent_fog_count`
24. `opponent_trump_count`
25. `opponent_grave_count`

#### Pattern Feature Names (57次元)
1. `pattern_is_action`
2. `pattern_is_pass`
3. `pattern_is_effect_selection`
4. `pattern_is_other`
5. `has_action`
6. `action_speed_normal`
7. `action_speed_immediate`
8. `action_speed_other`
9. `action_timing_main`
10. `action_timing_quick`
11. `action_timing_block`
12. `action_timing_damage_judge`
13. `action_timing_other`
14. `has_cost`
15. `cost_discard_count`
16. `cost_driven_bulwark_count`
17. `cost_sacrificed_unit_count`
18. `cost_life_count`
19. `has_key_card`
20. `key_card_count`
21. `key_card_known_count`
22. `key_card_value_sum`
23. `key_card_value_max`
24. `key_card_spade_count`
25. `key_card_heart_count`
26. `key_card_diamond_count`
27. `key_card_club_count`
28. `has_key_unit`
29. `key_unit_count`
30. `selected_unit_size_sum`
31. `selected_unit_size_max`
32. `selected_unit_charge_count`
33. `selected_unit_drive_count`
34. `selected_unit_face_up_count`
35. `selected_unit_face_down_count`
36. `has_target`
37. `target_is_player`
38. `target_is_unit`
39. `target_is_request`
40. `target_is_none`
41. `target_is_other`
42. `target_is_self`
43. `target_is_opponent`
44. `target_unit_size`
45. `target_unit_is_charge`
46. `target_unit_is_drive`
47. `target_unit_face_up`
48. `target_unit_face_down`
49. `has_effect_selection`
50. `effect_type_unit`
51. `effect_type_unit_assignment`
52. `effect_type_other`
53. `effect_selected_value_count`
54. `effect_assignment_count`
55. `effect_assigned_unit_total`
56. `has_order_selection`
57. `ordered_item_count`

### Privacy & Versioning Contract
1. **Privacy Contract**:
   - `DecisionFeatureEncoder` の入力は `Readonly<DecisionRequest>` のみ。
   - `GameState`, `GameSession`, `Snapshot`, `RulePackage` への直接アクセス・裏口参照は禁止。
   - 相手手札の非公開カード、相手伏せ防壁、相手Life 10枚以上時の正確な枚数は完全に秘匿。
   - 実行時動的 ID (`decisionId`, `matchId`, `opaqueCardId`, `cardInstanceId`, `unitId` 等の文字列) や表示用文字列 (`player.name`, `actionName`, `displayName`, `summary`) は特徴量値として使用禁止。
   - すべての特徴量値は有限数値 (`Number.isFinite(v) === true`)。
2. **Versioning Contract**:
   - 特徴量の意味論や次元数を変更する場合にのみ `featureSchemaVersion` をインクリメント (例: v2)。
   - 単なる新規 Action や Component の追加（既存 DSL で表現可能）では、固定次元数・汎用メタデータにより `featureSchemaVersion: 1` を維持。
3. **Master + Extra 互換原則**:
   - `action.attack` などの特定アクション名や component ID のハードコード、Action ID のハッシュバケット特徴量は一切使用しません。
   - 将来より高度な Action 意味理解が必要な場合は、Action ID hardcode ではなく汎用的な semantic traits として別途設計します。

### Phase 3.0.1 検証保証
1. **Full Viewer Symmetry 保証**:
   - Context 特徴量だけでなく全 Pattern 特徴量ベクトル（および `logicalPatternKey`）について、鏡像関係の盤面・カタログでプレイヤー視点（viewer）が入れ替わった場合でも、相対特徴量が 100% 完全一致することをテスト検証。
2. **実 GameSession EFFECT_RESOLUTION 統合保証**:
   - 手動作成（synthetic）の `EFFECT_SELECTION` のみならず、実際の `GameSession` の Stage 解決フロー（Attack 宣言 $\rightarrow$ P1 PASS $\rightarrow$ P2 PASS）から生成された `source.type === "EFFECT_RESOLUTION"` の `DecisionRequest` を `DecisionFeatureEncoder` でエンコードし、固定次元数・有限数値・`source_is_effect_resolution: 1`・`pattern_is_effect_selection: 1` が成立することをテスト検証。
3. **Runtime / Presentation / Opaque / ID Rename 不変性保証**:
   - Context および全 Pattern 特徴量ベクトルについて、実行時動的 ID (`decisionId`, `matchId`, `stateVersion`)、表示用文字列 (`player.name`, `actionName`, `displayName`, `summary`)、非公開カード Opaque ID (`opaqueCardId`)、および参照関係を維持したエンティティ ID 一括リネーム (`cardInstanceId`, `unitId`) に対し、全数値特徴量が 100% 一致することをテスト検証。

---

## 5. Decision DNA v1 & Deterministic Genome Policy (Phase 3.1)

### Decision DNA v1 Architecture
```text
EncodedDecisionFeatures (Context Vector 25次元 + Pattern Vectors 57次元)
    ↓
GenomeScorer (Pure Functional / Stateless)
    score(p) = Σ w_j * p_j + Σ Σ M_ij * c_i * p_j
    (Pattern Weights: 57次元 + Context-Pattern Interaction Weights: 1425次元 = 計 1482 重み)
    ↓
Deterministic Argmax Selection
    - 最高スコアの合法手 (pattern) を選択
    - 同点時は最小 patternRef インデックスを優先 (RNG 非依存の完全決定論的タイブレーク)
    ↓
DecisionResponse (Action / Pass / EffectSelection)
```

### DNA Structure & Validation Contract
1. **Version & DTO Contract**:
   - `dnaFormatVersion: 1`, `featureSchemaVersion: 1`, `scoringModel: "linear-bilinear-v1"`
   - `contextDimension: 25`, `patternDimension: 57`, `totalWeights: 1482`
   - `patternWeights: number[]` (57次元)
   - `contextPatternWeights: number[]` (1425次元, row-major: `c_idx * 57 + p_idx`)
   - `DecisionDNACodec.validate(dna)` による厳格な次元・有限数値 (NaN / Infinity 除外) 検証
   - `DecisionDNACodec.clone(dna)` による外部 mutation からの完全保護
2. **Context-only Additive Weight を除外する数学的根拠**:
   - 行動選択は $\arg\max_{p \in \mathcal{P}} \text{score}(p)$ で行われる。
   - 仮に Context 単独のバイアス項 $\sum_{i} u_i c_i$ を加算した場合、同一リクエスト内のすべての合法手 $p$ に対してこの値は同一の定数値 $C = \sum_{i} u_i c_i$ となる。
   - 任意の定数 $C$ に対して $\arg\max_p (\text{score}(p) + C) = \arg\max_p \text{score}(p)$ が常に成立するため、Context 単独バイアスは行動順位付けに一切寄与せず相殺される（識別不能な Dead Weight）。
   - パラメータの冗長性排除と探索空間の最小化のため、Context 単独重みはモデルから完全に除外している。
3. **RNG 独立性 & 決定論的タイブレーク**:
   - `GenomePolicy` は乱数源 (`RandomSource`) を一切必要とせず、乱数消費も発生しない純粋決定論的写像 `(DecisionRequest, DecisionDNA) -> DecisionResponse` を実現。
   - 複数手が同点（重みゼロの初期状態を含む）の場合は、`DecisionRequest.legalPatterns` における最小の `patternRef`（先頭合法手）を一意に選択する。
4. **Master + Extra 互換原則**:
   - 特定の Action タイプやルールの決め打ちを行わず、`DecisionFeatureEncoder` が生成する汎用特徴量に対して重み付けを行うため、ルール拡張（Master / Extra）に対しても同一 DNA 構造で完全動作。
5. **DNA Artifact 保存と分離契約**:
   - 1482 重みは DNA 単体 JSON アーティファクトとして保存・管理され、Match Log や `PolicyDescriptor` の内部にはシリアライズされない。
   - `PolicyDescriptor.metadata` には `dnaFormatVersion`, `featureSchemaVersion`, `scoringModel`, `dnaId`, `dnaName` などの軽量メタデータのみを保持し、Canonical Match Log や State Hash の肥大化を防止。

### DNA JSON Artifact Contract & Validation (Phase 3.1.1)
1. **JSON-Safe Metadata Contract**:
   - `DecisionDNAMetadata` に含まれるすべてのプロパティ値は厳格に `JSONValue`（`string`, 有限 `number`, `boolean`, `null`, `readonly JSONValue[]`, プレーンオブジェクト `{ [key: string]: JSONValue }`）に限定されます。
   - `number` 型は `Number.isFinite(v) === true` を必須とし、`NaN`, `Infinity`, `-Infinity` は即座に `DecisionDNAValidationError` として拒絶されます（JSON シリアライズ時の `null` 縮退を防止）。
   - `BigInt`, `function`, `Symbol`, `Date`, `RegExp`, `Map`, `Set`, カスタムクラスインスタンス、および循環参照（cyclic reference）は厳格に禁止・拒絶されます。
2. **Recursive Validation & Cycle Detection**:
   - `DecisionDNACodec.validateMetadata()` により、ネストされた配列・オブジェクトを再帰的に検証します。
   - 探索パス集合（active traversal path）を用いたサイクル検知により、循環参照を含む構造に対しても無限再帰やスタックオーバーフローを起こさず即座に例外をスローします。
3. **Deep Clone Isolation**:
   - `DecisionDNACodec.clone()` は、重み配列だけでなく `metadata` 内のネストされた配列およびオブジェクトを再帰的にディープクローンします。
   - クローンされた DNA や `GenomePolicy.getDNA()` の戻り値、または Policy 生成後の呼び出し元 DNA のプロパティを変更しても、元の DNA および Policy 内部の DNA との間に参照共有は一切残りません。
4. **Metadata Scoring Independence**:
   - `metadata` は管理・記録（世代、適応度、タグ、実験パラメータ等）のための純粋なメタ情報であり、`GenomeScorer.score` および `GenomePolicy.choose` の行動選択には一切関与しません。
   - `metadata` の有無や内容変更によって、出力されるスコアベクトルおよび `selectedPatternRef` は 100% 不変です。
### Factory Entry Validation (Phase 3.1.2)
1. **先行 Validation 順序の強制**:
   - `DecisionDNACodec.createZeroDecisionDNA(metadata)` は、`metadata !== undefined` の場合、ディープクローン処理 (`deepCloneMetadata`) を呼び出す前に必ず `validateMetadata(metadata)` を先行実行します。
   - 不正な型情報（`Date`, `Map`, `Set`, `RegExp`, カスタムクラスインスタンス等）がクローン処理でプレーンオブジェクト `{}` 等へ変形・偽装されてバリデーションを通過する脆弱性を完全に排除しました。
2. **Cycle Safety & Runtime Protection**:
   - 循環参照（cyclic metadata）が公開 Factory 入口に渡された場合でも、クローンによる無限再帰やスタックオーバーフロー (`RangeError: Maximum call stack size exceeded`) を起こさず、閉路検知により即座に `DecisionDNAValidationError` として安全に拒絶されます。
3. **厳格な型境界**:
   - `if (metadata)` のような truthy 判定を廃止し、`if (metadata !== undefined)` による厳格判定を採用。`null` や `array` などの不正値が渡された場合も、サイレントに `undefined` 扱いすることなく確実に `DecisionDNAValidationError` として拒絶されます。
4. **シミュレータ実装言語の原則**:
   - BlackPoker Simulator の実装、テスト、補助スクリプト、検証ロジック、データ変換は原則として **TypeScript / Node.js** へ統一します。
   - ユーザーからの明示的な承認がない限り、Python（`.py` スクリプト、仮想環境、pytest 等）は一切使用・導入しません。

---

## 6. Future Architecture (Phase 4.0 予定)

### Self-Play Evolution Cycle (Phase 4.0 予定)
1. **Population**: 100 DNA
2. **Generation Self-Play**: `BatchSimulationRunner` を用いた世代内トーナメント・総当たり戦
3. **Fitness Evaluation**: 勝率、平均ターン数、ライフ残量、対戦成果に基づく適応度評価
4. **Genetic Operators**: Selection, Crossover, Mutation $\rightarrow$ 次世代生成
5. **Hall of Fame**: 歴代チャンピオン DNA、baseline AI の保存
6. **Human Match Log Learning**: 人間の Canonical Match Log から特徴量を抽出し、初期 DNA シードへ反映

