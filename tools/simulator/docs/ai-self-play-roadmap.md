# BlackPoker Simulator AI Self-Play & Decision DNA ロードマップ

作業ID: `BP-SIM-AI-SEMANTIC-STALL-CYCLE-IMPL-V1-R1`
更新日時: 2026-10-17 02:00 JST

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
| **Decision Feature Schema v2** | **SUPERSEDED** | `featureSchemaVersion: 2` | `src/tests/ai/decisionFeatureEncoder.test.ts`, `decisionFeaturePrivacyV2.test.ts` | 固定次元・順序保証（Context 100次元, Pattern 60次元, 合計 6060次元） |
| **Decision Feature Schema v3** | **SUPERSEDED BY FEATURE SCHEMA v4** | `featureSchemaVersion: 3` | `decisionFeatureRealActionEvidence.test.ts`, `decisionFeatureRequestTarget.test.ts` | Request Context 163, Pattern 111 (計 18204 weights) |
| **Decision Feature Schema v4** | **IMPLEMENTED / PENDING INDEPENDENT REVIEW** | `src/domain/ai/DecisionFeatureTypes.ts` (`featureSchemaVersion: 4`) | `decisionFeatureCandidateAction.test.ts`, `decisionFeatureGenericOption.test.ts`, `decisionFeatureRealActionEvidence.test.ts`, `decisionFeatureStageSemantics.test.ts` | Request Context 163次元, Pattern 143次元, 合計 23,452 weights (Candidate Action Identity + Generic Option Identity) |
| **Generic Feature Encoder v4** | **IMPLEMENTED / PENDING INDEPENDENT REVIEW** | `src/engine/ai/DecisionFeatureEncoder.ts`, `src/engine/decision/ObservationFactory.ts` | `decisionFeatureStageSemantics.test.ts`, `decisionFeatureRealActionEvidence.test.ts` | Stage Semantics Preservation (`stageRequests` = true Stage only, Stage外Source = `effectSourceRequest`), Candidate Action 16 buckets, Option 16 buckets, Source Speed/Timing 伝搬, Assignment 方向修正, Coverage Ratio セマンティクス修正 |
| **Viewer-relative Encoding** | **IMPLEMENTED** | `DecisionFeatureEncoder` (`self` vs `opponent`) | `src/tests/ai/decisionFeatureEncoder.test.ts` | 座席非依存・鏡像対称性保証 |
| **Secret-safe Feature Encoding** | **IMPLEMENTED** | `DecisionFeatureEncoder`, `ObservationFactory` | `src/tests/ai/decisionFeaturePrivacyV2.test.ts`, `decisionFeatureRequestTarget.test.ts` | 秘密情報・表示文字列・実行時ID完全遮断、相手伏せユニット対象時の秘密漏洩防止 |
| **Decision DNA v1 format (v4 Schema Compatible)** | **IMPLEMENTED / PENDING INDEPENDENT REVIEW** | `src/domain/ai/DecisionDNATypes.ts`, `src/engine/ai/DecisionDNACodec.ts` | `src/tests/ai/decisionDNA.test.ts` | 23,452次元 (Pattern 143, Interaction 23,309), 旧 v1/v2/v3 DNA は fail-closed 拒絶 |
| **Standard + Pack Target Foundation** | **IMPLEMENTED** | `src/engine/regulation/OfficialRegulationMatchSetup.ts` | `src/tests/ai/standardPackGenomeE2E.test.ts` | official:standard-pack での Genome 対戦・決定論・Pack観測・turnCount進行 E2E 完走 |
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
| **Genome Sensitivity / Policy Separability V1** | **IMPLEMENTED / PENDING INDEPENDENT REVIEW** | `src/engine/ai/GenomeSensitivityEvaluator.ts`, `src/engine/ai/GenomeSensitivityDNAFactory.ts` | `src/tests/ai/genomeSensitivity.test.ts`, `npm run simulate:genome-sensitivity` | DNA の違いが「スコア差 → 意思決定差 → 実対戦での行動差」として決定論的・再現可能に観測できることを実証 |
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
| **Genetic Operators V1** | **IMPLEMENTED / PENDING INDEPENDENT REVIEW** | `src/engine/ai/GeneticOperators.ts`, `GeneticCrossover.ts`, `GeneticMutation.ts`, `ParentPairAssembler.ts` | `src/tests/ai/geneticOperators.test.ts` | Block-Segmented Uniform Crossover, Deterministic Normal Mutation, Self-Mating Retry |
| **Runtime Match Telemetry V1** | **IMPLEMENTED / PENDING INDEPENDENT REVIEW** | `src/cli/support/RuntimeArtifactWriter.ts`, `BatchSimulationRunner.ts` | `src/tests/simulation/runtimeTelemetry.test.ts`, `src/tests/cli/runtimeArtifactWriter.test.ts` | Match/Batch wall-clock timing, Fail-Closed 統計, Benchmark Recipe |
| **Generation Builder / Next Generation Assembly** | **FORMAL ACCEPTED** | `src/engine/ai/GenerationBuilder.ts`, `docs/ai-generation-builder-design-v1.md` | `src/tests/ai/generationBuilder.test.ts` | 次世代母集団構築境界契約 (Generation g -> g+1) |
| **Generation Runner** | **FORMAL ACCEPTED** | `src/engine/ai/GenerationRunner.ts`, `src/domain/ai/GenerationRunnerTypes.ts` | `src/tests/ai/generationRunner.test.ts` (60 Canonical Tests) | 1世代自己対戦評価・適応度集計・次世代遷移 (Double Round Robin V1) |
| **Controlled One-Generation Evidence V1** | **FORMAL ACCEPTED** | `src/cli/generationRunnerControlledEvidence.ts`, `docs/ai-generation-runner-controlled-evidence-v1.md` | - | Official light-entry16, N=6, R=1, 30試合実機検証 (g=0 -> g=1) |
| **N=100 Scale Evidence V1-R1** | **FORMAL ACCEPTED** | `src/cli/generationRunnerScaleEvidence.ts`, `docs/ai-generation-runner-scale-evidence-v1.md` | - | Official light-entry16, N=100, R=1, 9,900試合実機完走 (g=0 -> g=1) |
| **Evolution Loop** | **FORMAL ACCEPTED** | `src/engine/ai/EvolutionLoop.ts`, `src/domain/ai/EvolutionLoopTypes.ts`, `docs/ai-evolution-loop-design-v1.md` (V1-R2) | `src/tests/ai/evolutionLoop.test.ts` (48 Canonical Tests) | 複数世代進化ループ統括オーケストレータ |
| **Controlled Multi-Generation Evidence V1** | **WAITING** | `src/cli/evolutionLoopControlledEvidence.ts`, `docs/ai-evolution-loop-controlled-evidence-v1.md` | - | Official light-entry16, N=6, R=1, g=0完走, g=1未完了28戦によるREEVALUATION_REQUIRED (診断基盤完了後に再挑戦) |
| **Evolution g1 Incomplete Analysis V1** | **FOLLOW-UP REQUIRED** | `src/cli/evolutionIncompleteAnalysis.ts`, `docs/ai-evolution-incomplete-analysis-v1.md` | - | Generation 1 での未完了28戦の原因分析 (PROGRESSING_LONG_MATCH, Turn 1 での PASS 過剰選好実証) |
| **Evolution g1 DNA PASS Score Analysis V1** | **NOT ACCEPTED / SUPERSEDED BY R1** | `src/cli/evolutionDnaPassScoreAnalysis.ts`, `docs/ai-evolution-dna-pass-score-analysis-v1.md`, `docs/ai-evolution-dna-pass-score-analysis-v1.json` | - | V1 分析（プロセス再実行問題により R1 へ差し替え） |
| **Evolution g1 DNA PASS Score Analysis V1-R1** | **NOT ACCEPTED / SUPERSEDED BY R2** | `src/cli/evolutionDnaPassScoreAnalysis.ts`, `docs/ai-evolution-dna-pass-score-analysis-v1-r1.md`, `docs/ai-evolution-dna-pass-score-analysis-v1-r1.json` | - | R1 再検証（JSON アーティファクトの perGenomeContributors キー欠陥により R2 へ差し替え） |
| **Evolution g1 DNA PASS Score Analysis V1-R2** | **FORMAL ACCEPTED** | `src/cli/evolutionDnaPassScoreAnalysis.ts`, `docs/ai-evolution-dna-pass-score-analysis-v1-r2.md`, `docs/ai-evolution-dna-pass-score-analysis-v1-r2.json` | - | R2 アーティファクト修復（perGenomeContributors 5オフスプリング完全修復、二重再構築A/B完全一致、全分解保存則、連続質量分析: Suppression 64.38%, Uplift 35.62%, 未正規化特徴量最大137増幅実証、個体別Top-3 Ablation完走実証） |
| **Feature Scaling Design V1** | **NOT ACCEPTED / SUPERSEDED BY R1** | `docs/ai-feature-scaling-design-v1.md`, `docs/ai-feature-scaling-registry-v1.json` | - | V1 設計（PowerShellプロセス違反および集計不整合により却下） |
| **Feature Scaling Design V1-R1** | **NOT ACCEPTED / SUPERSEDED BY R2** | `docs/ai-feature-scaling-design-v1-r1.md`, `docs/ai-feature-scaling-registry-v1-r1.json` | - | R1 設計（パラメータ不一致、Context値域誤記、固定上限誤記により却下） |
| **Feature Scaling Design V1-R2** | **FORMAL ACCEPTED** | `docs/ai-feature-scaling-design-v1-r2.md`, `docs/ai-feature-scaling-registry-v1-r2.json` | - | 全306特徴量の有界スケーリング設計、Registry完全同期、包括値域 c, p in [-1, 1]、不変条件 \|c_i * p_j\| <= 1、Feature Schema v5 契約 |
| **Feature Scaling Implementation V1** | **NOT ACCEPTED** | `docs/ai-feature-scaling-implementation-v1.md` | - | V1 実装（dist 混入および Evidence 不整合により却下） |
| **Feature Scaling Implementation V1-R1** | **NOT ACCEPTED / SUPERSEDED BY R2** | `docs/ai-feature-scaling-implementation-v1.md` | - | R1 実装（parameter 列挙不一致および diff 説明混同により R2 へ差し替え） |
| **Feature Scaling Implementation V1-R2** | **FORMAL ACCEPTED** | `src/domain/ai/DecisionFeatureScalingRegistry.ts`, `src/engine/ai/DecisionFeatureScaler.ts`, `docs/ai-feature-scaling-implementation-v1-r2.md` | `src/tests/ai/decisionFeatureScaling.test.ts`, `architectureBoundary.test.ts` | Feature Schema v5, Pure TypeScript Canonical Registry 306 features, Fail-Closed DecisionFeatureScaler, DecisionFeatureEncoder 統合, Negative Pattern Golden Test 完備, 27 AI テストスイート 509 tests 全件パス, dist/** 差分除外 |
| **Controlled Feature Scaling A/B Evidence V1** | **NOT ACCEPTED / SUPERSEDED BY R1** | `docs/ai-feature-scaling-ab-evidence-v1.md`, `docs/ai-feature-scaling-ab-evidence-v1.json` | - | V1 Evidence（Markdown内結果値ハードコード不整合、Weight再検証欠落、恒真アサーションにより却下） |
| **Controlled Feature Scaling A/B Evidence V1-R1** | **FORMAL ACCEPTED** | `src/cli/featureScalingABEvidence.ts`, `docs/ai-feature-scaling-ab-evidence-v1-r1.md`, `docs/ai-feature-scaling-ab-evidence-v1-r1.json` | `src/tests/ai/featureScalingABEvidence.test.ts`, `evidence:feature-scaling-ab` | CONTROL (RAW_V4_EQUIVALENT) vs TREATMENT (SCALED_V5) 決定論的比較検証、全9チェックポイント厳密Weight整合性(===)、動的Markdown生成、Scaler参照復元検証完備 |
| **Rule-side PASS / Core Flow** | **RULES UNCHANGED / NO CHANGE PLANNED** | `src/domain/rules/`, `src/engine/rules/` | `git diff --stat` (Rules / Core Flow diff: 0) | PASS Rule / Core Flow / Turn Player PASS legality / Stage Empty behavior は変更せず、AI側 Feature Scaling のみで対処 |
| **Semantic Stall / Cycle Detection Design V1** | **NOT ACCEPTED / SUPERSEDED BY R1** | `docs/ai-semantic-stall-cycle-detection-design-v1.md`, `docs/ai-semantic-fingerprint-field-registry-v1.json` | - | 受動的診断アーキテクチャ設計 (V1-R1へ改訂) |
| **Semantic Stall / Cycle Detection Design V1-R1** | **NOT ACCEPTED / SUPERSEDED BY R2** | `docs/ai-semantic-stall-cycle-detection-design-v1-r1.md`, `docs/ai-semantic-fingerprint-field-registry-v1-r1.json` | - | 2層判断Fingerprint（Request Semantic / Policy Input）、129フィールド監査、厳格非丸め、SHA-256統一、保守的サイクル用語、Continuation Research境界確定 (R2へ改訂) |
| **Semantic Stall / Cycle Detection Design V1-R2** | **NOT ACCEPTED / SUPERSEDED BY R3** | `docs/ai-semantic-stall-cycle-detection-design-v1-r2.md`, `docs/ai-semantic-fingerprint-field-registry-v1-r2.json` | - | Feature Schema v5整合（Pattern 143次元, total weights 23,452, version 5 number）、DecisionCatalog完全監査（primary/secondaryLabel追跡）、全131フィールド監査完了 (R3へ改訂) |
| **Semantic Stall / Cycle Detection Design V1-R3** | **NOT ACCEPTED / SUPERSEDED BY R4** | `docs/ai-semantic-stall-cycle-detection-design-v1-r3.md`, `docs/ai-semantic-fingerprint-field-registry-v1-r3.json` | - | Canonical Source参照整合（DecisionFeatureTypes.ts / DecisionDNATypes.ts 確定, 存在しないFeatureSchemaConstants.ts完全除去）、Current Runtime Field (130件) と Derived Research Candidate (2件: rulePackage.contentDigest, simulator.buildSha) の厳格分離、全132エントリプロパティ実在性監査完了 (R4へ改訂) |
| **Semantic Stall / Cycle Detection Design V1-R4** | **NOT ACCEPTED / SUPERSEDED BY R5** | `docs/ai-semantic-stall-cycle-detection-design-v1-r4.md`, `docs/ai-semantic-fingerprint-field-registry-v1-r4.json` | - | Policy State監査境界（DecisionDNA全プロパティ監査: cDim/pDim/scoringModel/metadata分離, PolicyDescriptor kind/policyVersion）、実在性監査証拠分類（TYPE_DECLARATION 80件, RUNTIME_ACCESS 57件, PRIVATE 1件, DERIVED 2件）、計140エントリ確定 (R5へ改訂) |
| **Semantic Stall / Cycle Detection Design V1-R5** | **NOT ACCEPTED / SUPERSEDED BY R6** | `docs/ai-semantic-stall-cycle-detection-design-v1-r5.md`, `docs/ai-semantic-fingerprint-field-registry-v1-r5.json` | - | $schema破損修復（top-level $schema正常保持、空文字キー完全排除）、declaringType明示AST検証（79件TYPE_DECLARATION + 1件TYPE_INDEX_SIGNATURE + 1件PRIVATE）、Behavioral Continuation vs Provenance Identity直交分離確定 (R6へ改訂) |
| **Semantic Stall / Cycle Detection Design V1-R6** | **NOT ACCEPTED / SUPERSEDED BY R7** | `docs/ai-semantic-stall-cycle-detection-design-v1-r6.md`, `docs/ai-semantic-fingerprint-field-registry-v1-r6.json` | - | Fail-Closed Status契約、gpif1とPolicy DNAの責務境界是正（EncodedDecisionFeatures出所確定）、Future Test #10過剰主張修正、first-encounteredタイブレーク実態整合、CCF GenomePolicy-onlyスコープ確定 (R7へ改訂) |
| **Semantic Stall / Cycle Detection Design V1-R7** | **NOT ACCEPTED / SUPERSEDED BY R8** | `docs/ai-semantic-stall-cycle-detection-design-v1-r7.md`, `docs/ai-semantic-fingerprint-field-registry-v1-r7.json` | - | SimulationRunner.run / GameSession実API統合境界整合（runMatch/applyDecision非実在API参照完全除去）、PASS / 2-PASS / Explicit End Core Flow意味論整合（PASSはターン終了しない、空ステージ2-PASSはターン継続、明示的action.endのみがターン進行） (R8へ改訂) |
| **Semantic Stall / Cycle Detection Design V1-R8** | **FORMAL ACCEPTED** | `docs/ai-semantic-stall-cycle-detection-design-v1-r8.md`, `docs/ai-semantic-fingerprint-field-registry-v1-r8.json` | - | state.turnCount rationale是正、Endライフサイクル完全整合（Normal Action積載/2-PASS/End解決/Charge/Draw）、PRE_DECISION単一サンプリング境界確定（5大Fingerprint同一時点採取） |
| **Semantic Diagnostic Implementation V1-R2** | **IMPLEMENTED / PENDING INDEPENDENT REVIEW** | `src/domain/ai/SemanticDiagnosticTypes.ts`, `src/engine/ai/SemanticCanonicalSerializer.ts`, `src/engine/ai/SemanticSHA256.ts`, `src/engine/ai/SemanticDynamicIdCanonicalizer.ts`, `src/engine/ai/SemanticFingerprintCalculator.ts`, `src/engine/ai/SemanticStallCycleDetector.ts`, `src/engine/simulation/SimulationRunner.ts` | `src/tests/ai/semanticDiagnostic.test.ts` | Canonical Design V1-R8準拠、受動的診断基盤、Pack/RareCards Structural完全網羅、effectSourceRequest/SideState sequence漏れ排除、絶対履歴上限契約（fail-closed）、シグナル呼称統制（NO_SIGNAL: 診断シグナル未検出） |
| **Diagnostic Controlled Evidence** | **NOT STARTED** | - | - | 未着手 |
| **Competitive Stall Escape** | **NOT STARTED** | - | - | 未着手 (将来 Policy 設計課題) |
| **Test / Adversarial DNA** | **NOT STARTED** | - | - | 未着手 (将来探索設計課題) |
| **Fitness Redesign** | **NOT STARTED** | - | - | 未着手 (Scaling / Stall レビュー後検討) |
| **N=100 Multi-Generation** | **NOT EXECUTED** | - | - | 未実行 |
| **Hall of Fame** | **NOT IMPLEMENTED / FUTURE** | - | - | Phase 4.0 で策定 |

---

## 2. Feature Coverage Table (16 カテゴリ)

| カテゴリ | カバレッジステータス | 説明・実装実態・テスト検証 Evidence |
|---|---|---|
| **1. Board Context** | **FULL** | 盤面全体、ターン進行、ライフ、手札統計、フィールドユニット、フォグ、切札、墓地、パック、レア、相対差分（100次元）。`decisionFeatureEncoder.test.ts` にて全項目検証。 |
| **2. Request Source** | **FULL** | `request_has_source`, `is_action`, `is_effect`, `is_zone_top`, コントローラー相対関係 (self/opponent) (6次元)。`decisionFeatureRealActionEvidence.test.ts` にて実リクエストから抽出検証。 |
| **3. Source Action Identity** | **FULL** | `StableIdentityEncoder` による固定長 16 バケット multi-hash。RulePackage 内現行37種のアクションIDにおいて衝突0件を実証 (`decisionFeatureHashCollision.test.ts`)。 |
| **4. Effect Step Identity** | **FULL** | `StableIdentityEncoder` による固定長 16 バケット multi-hash。Engine/ルール実装実態棚卸し全23種のステップIDにおいて衝突0件を実証 (`decisionFeatureHashCollision.test.ts`)。 |
| **5. Source Request Semantics** | **FULL** | speed (normal/immediate/other), timing (main/quick/block/damage_judge/other), visible key-card aggregate (5次元), generic target (12次元) (計 25次元)。Stage Request / 即時解決中リクエストから ObservationFactory 経由で漏洩なく伝搬し実機検証 (`decisionFeatureRealActionEvidence.test.ts`)。 |
| **6. Candidate Action Identity** | **FULL** | `StableIdentityEncoder` による固定長 16 バケット。ACTION Pattern 候補のアクションそのものの Stable Identity をエンコード。同一メタデータ (`action.synthetic.alpha` vs `beta`) において相互作用重みによる選好逆転を Scorer レベルで直接証明 (`decisionFeatureCandidateAction.test.ts`)。 |
| **7. Target Selection** | **FULL** | targetType (player/unit/request/none/other), targetOwner (self/opponent), target unit size, charge, drive, face up/down (13次元)。`decisionFeatureRequestTarget.test.ts` にて全経路検証。 |
| **8. Key Card / Key Unit** | **FULL** | key card (count, known, values, suits: 11次元), key unit (count, size sum/max, charge, drive, face: 8次元) (計 19次元)。`decisionFeatureEncoder.test.ts` にて検証。 |
| **9. Effect Unit Selection** | **FULL** | unit count, self/opp count, charge, drive, face up/down, size sum/max/min, attacker, blocker (12次元)。`action.attack` の実機実行でパターン識別を実証 (`decisionFeatureRealActionEvidence.test.ts`)。 |
| **10. Effect Card Selection** | **FULL** | `KnownCardAggregateEncoder` による card count, known count, suits, ranks, value sum/max/min, pair, multiplicity (17次元)。`action.search` での Ace vs Numeric 識別を実証 (`decisionFeatureRealActionEvidence.test.ts`)。 |
| **11. Generic Option Identity** | **FULL** | `StableIdentityEncoder` による固定長 16 バケット。EFFECT_SELECTION (option) の任意文字列候補値をエンコード。charge/drive のクリーンな分離、将来未知 options (`send_to_grave`, `future_trump_mode_x`) の識別、および Scorer レベルでの選好学習を直接証明 (`decisionFeatureGenericOption.test.ts`)。 |
| **12. Unit Assignment** | **FULL** | source/selected count, source/selected size sum/max/min, size delta sum, positive/negative delta count, self->opp, opp->self (13次元)。セマンティクスを厳密化し、`action.block` 実戦において相手アタッカーへの自軍ブロッカー指定が正しく `opp_to_self = 1`, `self_to_opp = 0` となることを実証 (`decisionFeatureRealActionEvidence.test.ts`)。 |
| **13. Selection Coverage Ratio** | **FULL** | candidate count, selected count, coverage ratio (3次元)。`candidateCount` のセマンティクスを Power Set パターン件数から候補 Universe 数（ユニット数、カード数、オプション数等）へ是正。`action.attack` にて 0体/1体/2体選択で 0.0, 0.5, 1.0 の正確なカバレッジ比率を実証 (`decisionFeatureRealActionEvidence.test.ts`)。 |
| **14. Order Selection** | **PARTIAL** | `has_order_selection`, `ordered_item_count` (2次元)。順序選択の有無と件数は捉えるが、詳細な並び順特徴量は安定性のため将来拡張として留保。 |
| **15. Down vs Up Differentiation** | **FULL** | Direct Action としての性質に基づき、Request Context の Action Identity バケットによる候補差別化および Scorer レベルでの選好学習 (Down $\rightarrow$ Small, Up $\rightarrow$ Large) を直接証明 (`decisionFeatureDownUpScorer.test.ts`, `decisionFeatureRealActionEvidence.test.ts`)。 |
| **16. Privacy Boundary** | **FULL** | 相手手札中身、相手伏せ防壁/切札、未公開サイズ、未開封パック中身、相手Life 10+、相手伏せユニット対象時の秘密カードを完全秘匿。`decisionFeaturePrivacyV2.test.ts`, `decisionFeatureRequestTarget.test.ts` にて完全遮断を実証。 |

---

## 3. Match Snapshot & Resume Foundation (Phase 1.2.1)

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

## 4. Batch Simulation & Failure Isolation Foundation (Phase 1.3 / 1.3.1)

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

## 5. Decision Feature Schema v3 & Request-Conditioned Scoring (Phase 3.0 / 3.1 / v3 R1)

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

Action ID や Effect Step ID に対する個別 one-hot カラムや手動 if 分岐は一切導入せず、固定長 multi-hash (`StableIdentityEncoder`) と汎用メタデータによって表現されているため、将来 Master や Extra で新アクションが追加されても Feature Schema の変更や DNA の次元数変更は不要です。

### Source Request Target の Observation 境界伝搬 (R1 是正)
以前は `DecisionFeatureEncoder` 内で未配線だった Source Request Target 特徴量 (`request_target_*`) について、GameState を直接参照せず、以下の合法的 Observation パスを通じて実装しました：
```text
Authoritative Stage Request
    ↓
ObservationFactory
    ↓
RequestView.target: TargetView (sanitized)
    ↓
PlayerObservation
    ↓
DecisionRequest
    ↓
DecisionFeatureEncoder (request_target_* 12次元を計算)
```
相手伏せユニットが対象の場合でも、`TargetView` には `unitId` のみを保持させ、内部カードや `currentSize` などの秘密情報は完全に遮断されます（`decisionFeatureRequestTarget.test.ts` にて Privacy 完全性を実証済み）。

---

## 6. Decision DNA JSON Artifact Contract (Phase 3.1.1 / 3.1.2)

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
5. **Factory Entry 先行 Validation (Phase 3.1.2)**:
   - `DecisionDNACodec.createZeroDecisionDNA(metadata)` は、`metadata !== undefined` の場合、ディープクローン処理 (`deepCloneMetadata`) を呼び出す前に必ず `validateMetadata(metadata)` を先行実行します。
   - 不正な型情報（`Date`, `Map`, `Set`, `RegExp`, カスタムクラスインスタンス等）がクローン処理でプレーンオブジェクト `{}` 等へ変形・偽装されてバリデーションを通過する脆弱性を完全に排除しました。

---

## 7. Pairwise Policy Experiment Harness Foundation (Phase 3.2)

### 1. 階層アーキテクチャ（第二のシミュレーションループを作らない）
```text
PolicyExperimentRunner
        ↓ (Leg 1 & Leg 2 のバッチ実行)
BatchSimulationRunner.run()
        ↓ (各試合の実行)
SimulationRunner.run()
        ↓
GameSession
```
- 実験専用のゲーム進行ループは一切新設せず、既存の `BatchSimulationRunner.run()` をそのまま再利用します。
- `GameSession`, `Core Flow`, `Stage`, `Chance`, `Observation`, `BatchSimulationRunner` 本体は変更しません。

### 2. Seat Swap 契約 & 決定論的 Paired Match Plan
- 基本単位: Participant A vs Participant B の Pairwise 実験。
- **Leg 1**: `p1 = A, p2 = B`（LegId: `"leg-a-as-p1"`）
- **Leg 2**: `p1 = B, p2 = A`（LegId: `"leg-b-as-p1"`）
- **同一Seed群保証**: Leg 1 と Leg 2 は同一の `baseSeed` および `matchesPerSeat` で計画され、同一 `matchIndex` で `matchSeed` と `playerSeeds` が完全に一致します。
- これにより、BlackPoker の先攻・後攻バイアスを完全に分離し、ポリシー自身の選択性能を公平に比較評価します。

### 3. 論理結果と実行時・診断メトリクスの完全分離
- **Logical Experiment Result**:
  - `experimentResultVersion: 1`
  - `PolicyExperimentLogicalFailure` には `matchIndex`, `matchId`, `baseSeed`, `matchSeed`, `playerSeeds`, `phase`, `errorName` のみを保持。
  - 実行時動的生成文字列（`decisionId` 等）が含まれ得る `errorMessage` およびスタックトレース `errorStack` は Logical Result から厳格に排除し、`PolicyExperimentRuntimeMetrics` / 診断領域へ分離。
  - 関数（`sessionFactory`, `policyFactory`）や Genome の 18204 重み配列は結果 JSON に保持せず、参照情報（`id`, `name`, `artifactRef`）のみを保存。
  - 同一設定での再実行時、`JSON.stringify(logicalResult)` は 100% 決定論的に一致します。

### 4. Outcome Summary 保存則 & ステータス分離
- **保存則保証**:
  - `wins + losses + draws === completedMatches`
  - `completedMatches + incompleteMatches + failedMatches === scheduledMatches`
- **ステータス厳格分離**:
  - `INCOMPLETE`（最大判断回数到達等）および `FAILED`（例外発生）は **Draw（引き分け）には数えません**。
  - `winRateOnCompleted` の分母は `completedMatches` のみとします。

### 5. 汎用 Decision Behavior 計測
- 軽量ラッパー `DecisionBehaviorObserverPolicy` により、意思決定の選択内容（`selectedPatternRef`）を 100% 透過しつつ、外部 Accumulator へ意思決定を通知。
- Action 固有の名称や Component ID（`action.attack` 等）は集計せず、汎用パターン種別（`ACTION`, `PASS`, `EFFECT_SELECTION`, `OTHER`）および決定元（`ACTION_REQUEST`, `EFFECT_RESOLUTION`）のみを集計。
- 母集団は `COMPLETED`, `INCOMPLETE`, `FAILED` にかかわらず、観測されたすべての正常意思決定を対象とします（0件時は rate = 0）。

---

## 8. Official Regulation Environment (Official Regulation Phase 1.0)

### 1. CORE-BATTLE-001 と公式レギュレーションの分離
- **CORE-BATTLE-001 の位置づけ**:
  - `CORE-BATTLE-001` はシミュレータの Core Flow、Stage、決定論、Snapshot、Batch、Feature Encoder、Experiment Harness 等の内部エンジニアリング検証を目的とした人工的な最小対戦環境です。
  - **`CORE-BATTLE-001` による勝敗、性能、メトリクス結果は、BlackPoker の公式なゲームバランス評価や AI 性能評価としては扱いません**。
- **公式レギュレーション（Light + Entry16）の確立**:
  - BlackPoker 公式ルール（第9.1.2版）に準拠した初の公式対戦環境「ライト（Format）」+「エントリー16（Frame）」を E2E 構築しました。
  - 今後の AI ポリシー評価、強化学習、自己対戦実験は本公式レギュレーション環境を基準として行われます。

### 2. Format と Frame の分離と合法性
- **ルール上の合法性と推奨の分離**:
  - 公式ルール 2.3 に基づき、すべての Format と Frame の組み合わせはルール上合法（`ruleLegal: true`）として扱われます。
  - 推奨レギュレーション（Table 2.1）は `recommendedFormatIds` として表現され、非推奨の組み合わせもルール違反（`RULE_INVALID`）ではなく `NOT_RECOMMENDED` と判定されます。
  - Simulator Phase 1.0 で未実装の組み合わせ（Standard/Pro/Master）については、ルール違反ではなく `SIMULATOR_NOT_IMPLEMENTED` としてフェイルファストします。

### 3. エントリー16 プレゲームセットアップ
- **固定16枚デッキ & カード保存則**:
  - 各プレイヤーは指定の16枚（♠A,2,3,K, ♡4,7,J,Q, ♢5,8,10,Q, ♣A,6,9,K; Jokerなし）をデッキとして使用。
  - シード付きシャッフルを経て、全16枚を Life ゾーンへ配置。
  - Life から7枚を初期手札として引く。
  - 防壁プリセット: Life から1枚を裏向き防壁として配置。
  - 兵士プリセット: Life の一番上から条件に合致する1枚を取り出し、初期兵士として配置。不適格なカードの場合は墓地へ送り、Life の一番上から再試行。Life が枯渇した場合は公式ルール 3.9.1 の規定に基づきゲーム上の敗北（SetupOutcome: TERMINAL）として処理。
  - 先攻決定後、先攻プレイヤーが Life から1枚ドローしてゲーム開始。先攻決定中またはゲーム開始ドロー時に Life が枯渇した場合は公式ルール第9.1.2版に勝敗規定が存在しないため勝敗を推測せず SetupOutcome: RULE_UNSPECIFIED として処理。
  - 各プレイヤーの全カード枚数（Hand + Field + Bulwark + Life + Grave）はゲーム中常に厳格に 16 枚を保存。

### 4. アタック制限ルール（プリセット兵 vs 召喚兵）
- **プリセット兵（`enteredFieldBeforeGame: true`）**:
  - ゲーム開始前から戦場に配置されているため、Turn 1 / 自身の最初のターンから通常通り攻撃宣言可能。
- **ゲーム中召喚兵（`enteredFieldTurn === currentTurn`）**:
  - 召喚されたターン中は攻撃不可（チャージ状態であっても不可、同ターン内に再チャージされても不可）。
  - ただし、エース（Ace）等の即時攻撃能力（`<速攻>` / haste）を持つユニットは召喚ターンでも攻撃可能。

### 5. Policy Experiment Harness とのシームレス統合
- `OfficialRegulationMatchFactory.createSessionFactory()` は、Phase 3.2 の `PolicyExperimentRunner` や `BatchSimulationRunner` に渡す `sessionFactory` を直接生成できます。
- これにより、公式レギュレーション下での Pairwise AI 対戦実験（Leg 1/2 の座席入替、同一シード決定論評価）が追加実装なしで即座に実行可能です。

---

## 9. Privacy, Stage Semantics & Versioning Contract

1. **Privacy Contract**:
   - `DecisionFeatureEncoder` の入力は `Readonly<DecisionRequest>` のみ。
   - `GameState`, `GameSession`, `Snapshot`, `RulePackage` への直接アクセス・裏口参照は厳禁。
   - 相手手札の非公開カード、相手伏せ防壁/切札、相手裏向きユニットの `currentSize`、相手Life 10枚以上時の正確な枚数、未開封パックの中身は完全に秘匿。
   - 実行時動的 ID (`decisionId`, `matchId`, `opaqueCardId`, `cardInstanceId`, `unitId` 等の文字列) や表示用文字列 (`player.name`, `actionName`, `displayName`, `summary`) は特徴量値として使用禁止。
   - すべての特徴量値は有限数値 (`Number.isFinite(v) === true`)。
2. **Stage Semantics Preservation Contract**:
   - `PlayerObservation.stageRequests` および `stageRequestRefs` には、**実際に `state.stage.requests` に存在する Request のみ** を格納する。
   - `stage_depth` 特徴量は厳格に実 Stage 上のリクエスト数（`obs.stageRequests.length`）のみを反映する。
   - 即時解決アクション等の Stage 外 Source Request は `PlayerObservation.effectSourceRequest?: RequestView` という別キャリアで安全かつサニタイズされた View として伝搬する。
   - Stage 上に既に存在するリクエストは `stageRequests` から参照され、`effectSourceRequest` への二重計上は行われない。
   - これにより、`effect_selected_request_*` 等の Request 選択特徴量に Stage 外の偽リクエストが混入することを防止する。
3. **Versioning & Fail-Closed Contract**:
   - `FEATURE_SCHEMA_VERSION = 4`, `DNA_FORMAT_VERSION = 1`, `scoringModel: "linear-bilinear-v1"`。
   - 総次元数: Context 163次元, Pattern 143次元, Total 23,452 重み。
   - 旧 v1, v2, v3 DNA は、暗黙の zero padding やマイグレーションを行わず、`DecisionDNAValidationError` により **Fail-Closed で拒絶** されます。
4. **Master + Extra 互換原則**:
   - 特定のアクション名に対する手動ルール（`if (actionId === "action.down")` 等）は一切使用しません。
   - 新規 Action や Trump 追加時も、`StableIdentityEncoder` の固定長 multi-bucket hashing によりスキーマ変更不要で即座に観測・学習可能です（`action.synthetic.alpha/beta` による実証済み）。
5. **シミュレータ実装言語の原則**:
   - BlackPoker Simulator の実装、テスト、補助スクリプト、検証ロジック、データ変換はすべて **TypeScript / Node.js**（および Docker, npm, shell command）へ統一します。
   - Python（`python`, `python3`, `pip`, `venv`, `pytest`, `*.py` 等）は一切使用・導入・作成しません。

---

## 10. Genome Sensitivity & Policy Separability Foundation (BP-SIM-AI-GENOME-SENSITIVITY-V1 / V1-R1)

Status: **IMPLEMENTED / PENDING INDEPENDENT REVIEW**

### 1. 目的と位置づけ
- Evolution Engine (Phase 4.0) を実装する前の不可欠な前提確認として、Decision Feature Schema v4 / Decision DNA v1 / GenomePolicy において、
  **「DNAの違い $\rightarrow$ スコア差 $\rightarrow$ 意思決定差 $\rightarrow$ 実対戦での行動差」**
  として実際に観測できることを、決定論的かつ再現可能なエビデンスとして確立しました。
- DNA が単にファイル保存できる数値配列ではなく、Production Path 上で明確な行動変化をもたらすことを実証しています。

### 2. アーキテクチャ原則
- **第二の Simulation Loop を作らない**:
  対戦評価は既存の `PolicyExperimentRunner` $\rightarrow$ `BatchSimulationRunner` $\rightarrow$ `SimulationRunner` $\rightarrow$ `GameSession` の本番経路を完全再利用。
- **BatchMatchContext の透過的伝搬 (R1)**:
  `GenomeSensitivityEvaluationOptions.sessionFactory` は `(context: BatchMatchContext) => GameSession` を受け取り、`BatchSimulationRunner` が決定論的に生成した各試合固有の `ctx.matchSeed` を `OfficialRegulationMatchSetup.setupMatch()` および `GameSession` へ確実に伝搬します。
- **Seat Swap の公平性 (R1)**:
  同一 `baseSeed` において、同じ `matchIndex`（Leg 1 と Leg 2）では完全に同一の `matchSeed` が使用され、異なる `matchIndex` では異なる derived seed が使用されることで、先攻・後攻バイアスを排除した公平な対戦環境を保証します。
- **意思決定評価ロジックの非複製**:
  特徴量エンコードは `DecisionFeatureEncoder`、スコアリングは `GenomeScorer`、選択規則は `GenomePolicy`（Argmax + 最小 patternRef タイブレーク）の既存実装を使用。
- **汎用特徴量のみによる行動分離**:
  特定 Action ID や Component ID への手動分岐・重みを一切排除し、`pattern_is_action` や `pattern_is_pass` などの汎用特徴量のみでコントラスト DNA を構成。
- **厳格な Fail-Closed 総合判定 (R1)**:
  対戦実験中に 1 件でも FAILED 試合が存在する場合（`totalFailedMatches > 0`）、いかなる場合も `POLICY_SEPARABLE` と判定せず、`INSUFFICIENT_EVIDENCE` として安全にフェイルクローズします。
- **INCOMPLETE と DRAW の厳格な分離 (R1)**:
  最大意思決定手数（`maxDecisionsPerMatch`）到達などによる中断試合（INCOMPLETE）は「引き分け（DRAW）」としては集計・表示せず、厳密に `Incomplete` として分離します。

### 3. 実証されたエビデンス体系
1. **Decision-Level Linear Weight Sensitivity**:
   - `pattern_is_action` (+5.0) vs `pattern_is_pass` (+5.0) の汎用重み差分により、実 GameSession リクエストにおいて 158 パターンすべてでスコア差（差分 8.0）が発生し、DNA A は `patternRef 0 (ACTION)`、DNA B は `patternRef 157 (PASS)` を選択（選択分離: `SEPARATED`）。
2. **Context × Pattern Interaction Weight Sensitivity**:
   - 実戦で活性化した Context Feature（例: `turn_count`, `self_is_turn_player` 等）と Pattern Feature の相互作用重み $M_{ij}$（`DecisionDNACodec.getContextPatternWeightIndex()` 経由）の変更により、スコア差が発生することを実証。
3. **Inactive Gene Negative Control**:
   - 当該リクエストで非活性（値が 0）な Context Feature の重みを変更しても、全合法手のスコアおよび選択が完全に不変（差分 0）であることを実証。DNA $\rightarrow$ 活性特徴量 $\rightarrow$ スコアの因果関係を証明。
4. **Same DNA & Metadata Negative Controls**:
   - DNA A とその完全 clone、および metadata のみ異なる同一重み DNA を比較した場合、スコア・選択・差分が完全一致（差分 0）することを実証。
5. **Match-Level Policy Separability**:
   - 公式レギュレーション `official:standard-pack` 上で Seat Swap（Leg 1: A=p1, B=p2 / Leg 2: B=p1, A=p2）対戦を実行。
   - FAILED 試合 0 件で全スケジュール対戦を正常完走。
   - Generic 行動メトリクスにおいて、Participant A は Action 選択率 2.4%、Pass 選択率 97.0%、Participant B は Action 選択率 0.0%、Pass 選択率 100.0% を記録し、再現可能な行動差（Action 差 -2.4%, Pass 差 +3.0%）を実証。
6. **決定論性 (Determinism)**:
   - 同一設定での再実行において、論理結果（Logical Result）および matchSeed sequence が 100% 完全一致（JSON round-trip 完全同一）することを確認。

---

## 11. Future Architecture (Phase 4.0 予定)

### 1. Self-Play Evolution Cycle (BP-SIM-AI-EVOLUTION-V1 予定)
1. **Population Model (BP-SIM-AI-POPULATION-SELECTION-V1)**:
   - **実装ステータス**: **IMPLEMENTED / PENDING INDEPENDENT REVIEW** (`PopulationSnapshot`, `PopulationSelectionTypes`)
   - **母集団規模**: `populationSize = 100` (Provisional Default, configurable $\ge 2$)
   - **不変スナップショット**: 世代評価中のメンバー追加・削除禁止。DNA と Fitness の厳格な分離（DNA オブジェクトへスコアを直接書き込まない）。
   - ※詳細設計仕様: `tools/simulator/docs/ai-population-selection-design-v1.md` 参照。
2. **Generation Self-Play**: `BatchSimulationRunner` および `PolicyExperimentRunner` を用いた世代内評価 (Seat Swap / Multi Seed 公平性保証)
3. **Fitness Evaluation (Outcome-First V1, BP-SIM-AI-FITNESS-EVAL-V1)**:
   - **実装ステータス**: **IMPLEMENTED / PENDING INDEPENDENT REVIEW** (`FitnessEvaluator`, `FitnessEvaluationTypes`)
   - **最重要原則**: "Victory is the objective. Life is a resource, not a score."
   - **主評価指標**: 勝敗結果（Outcome）に基づく Match Point Average (MPA: Win=1.0, Draw=0.5, Loss=0.0 on Completed Matches)。
   - **Telemetry 分離**: 残りライフ（Remaining Life）、ターン数（Turn Count）、被ダメージ等は Fitness 計算から完全に除外。分析・研究・異常検知のための Telemetry メトリクスとして独立記録。
   - **厳格なステータス分離**: `FAILED != LOSS`（Fail-Closed ゲートにより即座に失格/除外。Authoritative Fitness Score 不在 `fitnessScore: null`）、`INCOMPLETE != DRAW`（未決着は引き分けに含めず除外）。
   - **Evidence Sufficiency (VALID 条件)**: `failedMatches === 0 AND completedMatches >= minimumCompletedMatches AND completionRate >= minimumCompletionRate` を満たす場合のみ `VALID`（Authoritative Score 確定）。不足時は `INSUFFICIENT_EVIDENCE` として保留（通常選択プール除外、過大評価防止）。※閾値は初期仮値（Provisional Defaults: minCompleted=10, minRate=50%）。
   - **0 試合完了の厳格な扱い**: `completedMatches === 0` の場合は `provisionalScore = null`（0 勝全敗 0.0 と区別）。
   - **※ 未実装コンポーネント**: Crossover, Mutation, Generation / Evolution Loop は未実装のまま維持。
   - ※詳細設計仕様: `tools/simulator/docs/ai-fitness-design-v1.md` 参照。
4. **Parent Selection (BP-SIM-AI-POPULATION-SELECTION-V1)**:
   - **実装ステータス**: **IMPLEMENTED / PENDING INDEPENDENT REVIEW** (`PopulationSelector`, `PopulationSelectionTypes`)
   - **選択プール**: `VALID` 個体のみ（`fitnessScore = 0.0` の全敗個体も適格候補。`INSUFFICIENT_EVIDENCE` および `INVALID` は完全除外）。
   - **READY 条件 & サンプリング規約**: 1トーナメント内非復元抽出（without replacement）、トーナメント間再利用可。`validCount >= max(minValidPopulationCount, tournamentSize)` を満たす場合のみ `READY`（不足時は `REEVALUATION_REQUIRED`）。
   - **推奨アルゴリズム**: トーナメント選択（Tournament Selection, Provisional Engineering Default $k = 3$, Seeded Deterministic PRNG）。
   - **同点タイブレーク**: 配列順・ID順バイアスを排除したシード付き決定論的タイブレーク。
   - **エリート保存**: Provisional Default $E = 1$（早熟収束を防ぎつつ best-known genotype の消失を防止。※自己対戦環境変化に伴う measured fitness の単調非減少は保証しない）。
5. **Genetic Operators & Runtime Telemetry (BP-SIM-AI-GENETIC-OPERATORS-DESIGN-V1-R2 / BP-SIM-AI-GENETIC-OPERATORS-V1)**:
   - **設計ステータス**: **FORMAL ACCEPTED** (BP-SIM-AI-GENETIC-OPERATORS-DESIGN-V1-R2)
   - **実装ステータス**: **IMPLEMENTED / PENDING INDEPENDENT REVIEW** (BP-SIM-AI-GENETIC-OPERATORS-V1)
   - **交叉方式 (Crossover)**: Block-Segmented Uniform Crossover ($P_x = 0.5$、`patternWeights` 143 次元 $\rightarrow$ `contextPatternWeights` 23,309 次元を Canonical 順序で巡回、各遺伝子 1 draw、合計 23,452 draws 固定、ルール非依存・位置バイアスなし)。`GeneticCrossover.ts` 実装完了。
   - **突然変異方式 (Mutation)**: Deterministic Normal-Like Perturbation V1 (`deterministic-normal-approx-v1`、$p_m = 0.01$, $\sigma = 0.05$, clamp $[-10.0, +10.0]$、初等超越関数完全排除、12 個の uint16 上位 16 ビット和による Irwin-Hall 近似、uint32 整数閾値判定、非有限値検知時 Fail-Closed 例外停止、総 draw 数 $23,452 + 12 \times \text{mutatedGeneCount}$)。`GeneticMutation.ts` 実装完了。
   - **PRNG 消費規約 & ストリーム分離**: `nextUint32V1`（1 draw = 1 next()）、Crossover / Mutation / Self-Mating Retry の各 PRNG ストリームを完全分離。`GeneticRandom.ts` 実装完了。
   - **自己交配回避 & リトライ**: 同一 `genomeId` ペア検知時に最大 3 回リトライ、独立リトライシード派生、枯渇時も無性生殖+変異として受容しクラッシュ・不適格個体フォールバックを防止。`ParentPairAssembler.ts` 実装完了。
   - **シード体系 (既存 deriveSeed 再利用)**: `DeterministicShuffle.ts` の既存 `deriveSeed(baseSeed, streamKey)` を再利用（Option A 採用）。固定 Evolution Stream Keys（`evolution-selection-v1`, `evolution-offspring-v1-${i}`, `evolution-crossover-v1`, `evolution-mutation-v1`, `evolution-self-mating-retry-v1-${r}`）と Known Test Vectors 準拠。
   - **決定論的 Offspring Identity**: `gen-${pad(generation, 6)}-offspring-${pad(offspringIndex, 6)}` 形式（UUID・時刻完全排除）。エリートは既存 `genomeId` を保持。`GeneticOperators.ts` 実装完了。
   - **エリート継承**: Genotype は完全保存、**Fitness Score は非継承（次世代で必ず再評価）**。
   - **決定論性スコープ**: 同一 Node.js ランタイム・実装バージョン・DNA・設定・Seed・Stream Key において bit-exact 保証。異種アーキテクチャ間は Cross-Platform Conformance Target として実測検証。
   - **実行時間計測テレメトリ**: 1 試合の主指標 `matchTotalElapsedMs`（Session生成・Setupを含む実時間、COMPLETED/INCOMPLETE/FAILED 全対応）、バッチ集計における試合レイテンシ単純和 `sumMatchTotalElapsedMs`（Aggregate Match Latency、※CPU time ではない、`CPU Time Recorded: NO`）と実経過時間 `batchWallClockElapsedMs` の分離、並列度 `concurrency` を考慮したスループット算出公式、Median（奇数/偶数/0試合対応）および P95（Nearest-Rank Method、補間なし）。
   - **実行時成果物方針**: 大量生ログ（`matches.jsonl` 等）は Git 管理対象外。成果物ルートは `tools/simulator/.artifacts/ai-runs/<runId>/` に統一（`.gitignore` 設定済み）。
   - ※詳細設計仕様: `tools/simulator/docs/ai-genetic-operators-design-v1.md` 参照。
   - ※実装境界: Crossover, Mutation, Parent Pair Assembler, Offspring Generation の遺伝的操作子プリミティブ（V1）は実装・検証完了。Generation Runner, Evolution Loop, Hall of Fame, Runtime Match Telemetry は次段階のスコープ（未実装）。
6. **Generation Builder / Next Generation Assembly (BP-SIM-AI-GENERATION-BUILDER-V1 / V1-R3)**:
   - **設計ステータス**: **FORMAL ACCEPTED** (`tools/simulator/docs/ai-generation-builder-design-v1.md`)
   - **実装ステータス**: **FORMAL ACCEPTED** (`src/engine/ai/GenerationBuilder.ts`, `src/domain/ai/GenerationBuilderTypes.ts`, `src/tests/ai/generationBuilder.test.ts`)
   - **責務境界**: 世代 $g$ の `PopulationSnapshot` + `FitnessEvaluationSnapshot` から世代 $g+1$ の `PopulationSnapshot` を決定論的・Fail-Closed に構築。
   - **母集団サイズ契約**: `populationSize` は `finite integer >= 2` であり、アーキテクチャ上の恣意的な上限（例: $N \le 1000$ 等）は課さない。
   - **Effective Readiness**: Generation Builder 固有の要求条件 $\text{validCount} \ge \max(\text{standardRequiredValidCount}, \text{eliteCount})$ を定義。`validCount < eliteCount` の場合は `GenerationBuilderExecutionError`（`REEVALUATION_REQUIRED` 相当）で即時停止（エリート自動縮小や Tier 2 繰り上げ補完の完全禁止）。
   - **エリート継承**: Genotype は完全保存（ディープクローンによるオブジェクト参照隔離）、DNA metadata 不変、**Fitness は非継承（次世代でゼロから再評価）**。
   - **親選択・ペアリング**: 単一の決定論的親系列（$2M$ 体）を一括選出、隣接ペア化、`ParentPairAssembler` による自己交配回避リトライ（独立ストリーム）。
   - **dnaRef 規約**: Canonical Logical Ref (`genome:<genomeId>`) のみに完全固定。Local Logical DNA Reference であり、Global Artifact ID や Content Address ではない。
   - **決定論性保証**: Supported Deterministic Runtime 境界（同一 Node.js LTS、同一実装バージョン、同一入力、同一設定、同一シード、同一 Stream Key）において bit-exact / Deep Equal を保証。異種 OS / CPU アーキテクチャ間は Cross-Platform Conformance Target として実測検証。
   - **Lineage 境界**: `PopulationEntry` や DNA を汚染せず、`GenerationBuildResult` として分離。
7. **Generation Runner (BP-SIM-AI-GENERATION-RUNNER-V1 / BP-SIM-AI-GENERATION-RUNNER-SCALE-EVIDENCE-V1-R1)**:
   - **設計ステータス**: **FORMAL ACCEPTED** (`tools/simulator/docs/ai-generation-runner-design-v1.md`, SHA: `c45478bd23822689718f4c82ccb6befb8731a873`)
   - **実装ステータス**: **FORMAL ACCEPTED** (`tools/simulator/src/engine/ai/GenerationRunner.ts`, `tools/simulator/src/domain/ai/GenerationRunnerTypes.ts`, SHA: `2587017da393bd9c96172d5772ea5e0be3ebdb59`)
   - **Controlled Evidence**: **FORMAL ACCEPTED** (BP-SIM-AI-GENERATION-RUNNER-EVIDENCE-V1-R1, `tools/simulator/src/cli/generationRunnerControlledEvidence.ts`, `docs/ai-generation-runner-controlled-evidence-v1.md`, Official `light-entry16`, N=6, R=1, 30試合実機完走, g=0 -> g=1, SHA: `269017fcd0cdc3ce55e2c3021f8a06c4fd9e49c7`)
   - **N=100 Scale Evidence**: **FORMAL ACCEPTED** (BP-SIM-AI-GENERATION-RUNNER-SCALE-EVIDENCE-V1-R1, Independent Review, `tools/simulator/src/cli/generationRunnerScaleEvidence.ts`, `docs/ai-generation-runner-scale-evidence-v1.md`, Official `light-entry16`, N=100, R=1, 9,900試合実機完走, g=0 -> g=1, SHA: `0146f4ac6e071d8fd47f02e8f62f9dc37964ed30`)
   - **責務境界**: 世代 $g$ の自己対戦評価（Double Round Robin V1）、適応度集計（`FitnessEvaluator`）、次世代遷移（`GenerationBuilder`）を決定論的・Fail-Closed に実行する「ちょうど1世代」の実行境界。Canonical Error Taxonomy（Configuration / Integrity / ExecutionError）、実在試合専用フェーズ診断（SESSION_FACTORY / POLICY_FACTORY / RUNNER）、Builder Contract Drift の `GenerationRunnerIntegrityError` 統一、Preflight Fail-Fast 検証、および結果モデルの論理／実行時メトリクス分離を完全実装。
   - **未実装コンポーネント維持**: Parallel Evaluation, Hall of Fame は未実装（NOT IMPLEMENTED）のまま維持。
8. **Evolution Loop (BP-SIM-AI-EVOLUTION-LOOP-V1 / BP-SIM-AI-EVOLUTION-LOOP-EVIDENCE-V1 / BP-SIM-AI-EVOLUTION-INCOMPLETE-ANALYSIS-V1)**:
   - **設計ステータス**: **FORMAL ACCEPTED** (BP-SIM-AI-EVOLUTION-LOOP-DESIGN-V1-R2, Independent Review, `tools/simulator/docs/ai-evolution-loop-design-v1.md`, SHA: `18bf6813bafb55be600f65d16bccd300528fbf27`)
   - **実装ステータス**: **IMPLEMENTED / PENDING INDEPENDENT REVIEW** (`tools/simulator/src/engine/ai/EvolutionLoop.ts`, `tools/simulator/src/domain/ai/EvolutionLoopTypes.ts`, `tools/simulator/src/tests/ai/evolutionLoop.test.ts`, 48 Canonical Tests)
   - **Controlled Multi-Generation Evidence**: **BLOCKED / NOT ACCEPTED** (BP-SIM-AI-EVOLUTION-LOOP-EVIDENCE-V1, `tools/simulator/src/cli/evolutionLoopControlledEvidence.ts`, `docs/ai-evolution-loop-controlled-evidence-v1.md`, Official `light-entry16`, N=6, R=1, g=0 30試合完走・世代交代成功, g=1 28/30試合未完了による有効個体不足)
   - **Evolution g1 Incomplete Analysis V1**: **ANALYZED / PENDING INDEPENDENT REVIEW** (BP-SIM-AI-EVOLUTION-INCOMPLETE-ANALYSIS-V1, `tools/simulator/src/cli/evolutionIncompleteAnalysis.ts`, `docs/ai-evolution-incomplete-analysis-v1.md`, Generation 1 28/30未完了試合の決定論的分析, PROGRESSING_LONG_MATCH / Turn 1 PASS過剰選好の特定)
   - **Parallel Evaluation**: **NOT IMPLEMENTED**
   - **Hall of Fame**: **NOT IMPLEMENTED**
   - **責務境界**: `GenerationRunner`（1世代プリミティブ）を直接順次呼び出し、世代ごとの `generationSeed` 直接導出、世代間チェーン整合性検証、`REEVALUATION_REQUIRED` での即時論理停止、および中間母集団 DNA 複製を排除した決定論的履歴集計を統括する上位オーケストレーション境界。Caller による母集団サイズ契約（`runnerConfig.builderConfig.populationSize`）を尊重し、暗黙のサイズ一定仮定や自動改変を行わない。また、`GenerationRunner` 内部実装のオブジェクト参照同一性（Reference Equality）への依存を排除し、Public Logical Contract に準拠する。
9. **Hall of Fame**: 歴代チャンピオン DNA、baseline AI の保存
10. **Human Match Log Learning**: 人間の Canonical Match Log から特徴量を抽出し、初期 DNA シードへ反映
11. **Semantic Stall / Cycle Diagnostic V1 (BP-SIM-AI-SEMANTIC-STALL-CYCLE-IMPL-V1-R2)**:
    - **設計ステータス**: **FORMAL ACCEPTED** (`tools/simulator/docs/ai-semantic-stall-cycle-detection-design-v1-r8.md`, `tools/simulator/docs/ai-semantic-fingerprint-field-registry-v1-r8.json`)
    - **実装ステータス**: **IMPLEMENTED / PENDING INDEPENDENT REVIEW** (`src/domain/ai/SemanticDiagnosticTypes.ts`, `src/engine/ai/SemanticCanonicalSerializer.ts`, `src/engine/ai/SemanticSHA256.ts`, `src/engine/ai/SemanticDynamicIdCanonicalizer.ts`, `src/engine/ai/SemanticFingerprintCalculator.ts`, `src/engine/ai/SemanticStallCycleDetector.ts`, `src/engine/simulation/SimulationRunner.ts`, `src/tests/ai/semanticDiagnostic.test.ts`)
    - **設計原則**: 受動的診断器（Passive Observer, `DEFAULT = DISABLED`）。診断の有無でゲーム進行、StateHasher、勝敗判定、手番進行、乱数消費を一切変えない。
    - **100% 決定論的パリティ契約**: 診断 OFF vs ON において、`completed`, `winner`, `reason`, `totalDecisions`, `turnCount`, `finalStateHash`, `decisionTrace` の論理プロパティが 100% byte-identical に一致することを保証。
    - **5大フィンガープリント**: `sgf1` (盤面構造 + Side State, Turn-Aware), `sgf1-ti` (盤面構造 + Side State, Turn-Invariant), `pof1` (PlayerObservation), `drsf1` (DecisionRequest Root + Observation + Patterns), `gpif1` (GenomePolicy Scoring Input Projection: EncodedDecisionFeatures)。
    - **サンプリング境界**: `PRE_DECISION`（`WAITING_FOR_DECISION` 到達後、`policy.choose` 呼出前の単一境界で5大Fingerprintを同時サンプリング）。
    - **Canonical 診断シグナル分類**:
      - `NO_SIGNAL`: 診断シグナル未検出（diagnostic signal not detected）（※ `NO_SIGNAL != GENUINE_LONG_PROGRESS`, `NO_SIGNAL != gameplay progress proven` であり、ゲーム進行の数学的証明とは主張しない）。
      - `REPEATED_STRUCTURAL_FINGERPRINT`: 同一の構造的盤面フィンガープリント（`sgf1`）が連続観測。
      - `REPEATED_DECISION_REQUEST`: 同一の判断要求意味論フィンガープリント（`drsf1`）が連続観測。
      - `REPEATED_POLICY_INPUT`: 同一のポリシー入力数値フィンガープリント（`gpif1`）が連続観測。
      - `PERIODIC_FINGERPRINT_CANDIDATE`: リングバッファ（$M=64$）内において周期 $k \ge 2$ の再帰が複数回反復観測（周期循環候補）。
      - `NO_SEMANTIC_CHANGE_WINDOW`: 指定ウィンドウ（例: 20 決定）の間、意味的盤面更新が発生しなかった。
    - **R2 改訂点**:
      - `sgf1` / `sgf1-ti` における `state.players[pKey].pack` および `state.players[pKey].rareCards` の完全網羅（カード順序厳格保持、Dynamic ID 正規化、FULL_STATE 意味論保持）。
      - `effectSourceRequest` および Side-State（`resolvingRequest`, `continuation`, `resolvingContext`）からの絶対 sequence / bookkeeping 漏れ完全排除。
      - 診断オプションの fail-closed バリデーション契約（`SemanticDiagnosticValidationError`）導入、`historySize` / `traceRetentionLimit` の絶対上限（$M \le historySize$）保証。
      - `NO_SIGNAL` の用語定義を「診断シグナル未検出（diagnostic signal not detected）」へ統制。



