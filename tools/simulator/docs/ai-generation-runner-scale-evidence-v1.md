# BlackPoker Simulator
# N=100 One-Generation Scale Evidence V1-R1 Report

作業ID: `BP-SIM-AI-GENERATION-RUNNER-SCALE-EVIDENCE-V1-R1`
更新日時: 2026-10-14 18:55 JST
対象ブランチ: `BlackPoker/issue551-core-flow`
開始 HEAD SHA: `389bdebd3a51d9c5cb621e302e9240a5825e29e4`
最終ステータス: **READY FOR INDEPENDENT REVIEW**

---

## 1. Scope (スコープと目的)

本エビデンス（Scale Evidence V1-R1 Follow-up）の目的は、`BP-SIM-AI-GENERATION-RUNNER-SCALE-EVIDENCE-V1` の Independent Review で指摘されたベンチマーク信頼性およびメモリ診断表現上の不確実性を解消し、同一の Controlled Scale Recipe において「残存プロセス0件」「ハーネス完全凍結（Blob検証）」「1回限りの厳密な単独実機実行」のもとで Canonical Candidate となる単独実測値を確定することです。

- **実行可能性**: モックやダミーではない実在の本番パス（Official Regulation $\to$ Official Match Setup $\to$ GameSession $\to$ GenomePolicy $\to$ SimulationRunner $\to$ GenerationRunner.aggregateOutcomes $\to$ FitnessEvaluator $\to$ PopulationSelector $\to$ GenerationBuilder）で 9,900 試合を例外なく処理できること。
- **単独実測性能**: 競合ワークロードの完全排除およびハーネス凍結下での壁時計所要時間、試合実行実時間、対戦処理速度（matches/sec）、総意思決定数（total decisions）の実測。
- **整合性・保存則**: 9,900 試合全戦の COMPLETED / INCOMPLETE / FAILED 集計、座席対称性（全 100 個体で P1=99, P2=99）、勝敗保存則、試合数保存則の成立。
- **適応度・遷移**: 全 100 個体の適応度判定分布（INVALID=0）、適応度スコア分布、Readiness 事前判定、Generation 1 母集団への正常遷移。
- **外挿値・予備実測との比較**: $N=6$ 外挿見込み（17.3〜17.8分）、V1 Preliminary（20.13分）、および R1 単独実測値（19.93分）の明確な区別と評価。

### スコープ外・禁止事項
- 大量世代進化ループ（Evolution Loop: 複数世代の連続走行）は実装・実行しない。
- 並列化（Worker Threads, multi-process, cluster）は実装しない（Sequential V1 のみ）。
- $N=100$（9,900 試合）の同一再実行（Run A-2）や結果向上のための再試行は一切行わない。
- Generation 1 母集団の再評価は行わない。
- 本番モジュール、公式レギュレーション、ルール DSL の改変は一切行わない（Production Diff 0）。
- 結果を良く見せるための設定変更やシード探索は一切行わない。

---

## 2. Benchmark Provenance & Process Compliance (実行の厳密性検証)

本 R1 単独実測において、ベンチマークの正当性を担保する以下のプロセス制約を厳密に順守・実測しました。

- **Pre-run scale process count**: 0 件（`docker top bp-simulator` にて競合プロセスが存在しないことを確認）
- **Competing Simulator workload**: NONE（vitest, npm test, tsc, vite build, playable なし）
- **Quiescence Gate**: **PASS**
- **PRE_RUN_HARNESS_BLOB**: `d7fc098d9daeff837759804fbfdd45e5e28df6f7`
- **POST_RUN_HARNESS_BLOB**: `d7fc098d9daeff837759804fbfdd45e5e28df6f7`
- **Harness Blob Equal**: **YES**（実行開始から終了まで 1 バイトの変更もなし）
- **Actual Run attempts**: **1 回のみ**（再試行・事後修正なし）
- **Actual Run exit code**: `0` (Success)
- **Post-run scale process count**: 0 件（孤児プロセスの残存なし）

---

## 3. Environment (実行環境)

- **Node.js バージョン**: `v20.20.2`
- **プラットフォーム**: `linux` (Docker コンテナ `bp-simulator` 内)
- **アーキテクチャ**: `x64`
- **CPU モデル**: `Intel(R) Core(TM) Ultra 7 155U`
- **論理 CPU 数**: `14`
- **総物理メモリ**: `16,478,105,600` bytes (約 16.5 GB)
- **Python**: 完全不使用（`python`, `python3`, `pip`, `pytest`, `*.py` 一切不使用）
- **Host Node/npm/npx**: 完全不使用（Docker コンテナ内実行へ統一）
- **PowerShell**: 参照専用（ファイル書き込み一切なし）
- **内部パス隔離**: `.gemini/**`, `antigravity/brain/**`, `transcript.jsonl`, `task.md`, `implementation_plan.md` 一切不使用

---

## 4. Canonical Recipe (実験レシピ)

| パラメータ名 | 設定値 | 決定根拠 / 参照元 |
|---|---|---|
| **Regulation ID** | `light-entry16` | Official Regulation カタログより直接ロード |
| **Format ID** | `light` | `RegulationDefinition.formatId` 実測値 |
| **Frame ID** | `entry16` | `RegulationDefinition.frameId` 実測値 |
| **Rule Package Version** | `1.0.0` | `officialRulePackage.version` 実測値 |
| **Environment Ref** | `official:light-entry16` | `GenerationRunnerEnvironmentContext` 規約 |
| **Population Size ($N$)** | `100` | スケール検証母集団サイズ |
| **Target Generation ($g$)** | `0` | 初期世代 |
| **Genome IDs** | `genome-000` 〜 `genome-099` | 決定論的 100 個体（`genome:genome-XXX`） |
| **DNA Type** | `Zero Decision DNA` | `DecisionDNACodec.createZeroDecisionDNA()` |
| **Pair Repetitions ($R$)** | `1` | Canonical Double Round Robin |
| **Total Matches ($M$)** | `9,900` | $N(N-1)R = 100 \times 99 \times 1 = 9,900$ |
| **Scheduled Matches / Genome** | `198` | $2(N-1)R = 2 \times 99 \times 1 = 198$ |
| **P1 Matches / Genome** | `99` | $(N-1)R = 99 \times 1 = 99$ |
| **P2 Matches / Genome** | `99` | $(N-1)R = 99 \times 1 = 99$ |
| **Generation Seed** | `42` | Canonical Controlled Seed |
| **Max Decisions / Match** | `500` | ステップ上限ガード |
| **Fitness Config** | `minCompleted: 10, minRate: 0.50` | `DEFAULT_FITNESS_EVALUATION_CONFIG` (無改変) |
| **Builder Config** | `populationSize: 100, elite: 1, tourney: 3` | `DEFAULT_GENERATION_BUILDER_CONFIG` 準拠 |
| **Execution Mode** | `Sequential V1` | 単一スレッド逐次実行 |

---

## 5. Canonical Manifest (Authoritative Context ID)

`result.logicalResult.manifest` から取得・検証した実測値:

- **`manifest.generation`**: `0`
- **`manifest.populationSize`**: `100`
- **`manifest.pairRepetitions`**: `1`
- **`manifest.totalMatches`**: `9900`
- **`manifest.generationSeed`**: `42`
- **`manifest.evaluationScheduleId`**: `double-round-robin-v1:r=1:max-decisions=500` (完全一致)
- **`manifest.seedScheduleIdentity`**: `evolution-evaluation-pair-v1:generation-seed=42` (完全一致)

---

## 6. Schedule Verification (スケジュール実測)

`GenerationRunner.planSchedule(initialPopulation, 42, 1)` から生成された実際のスケジュール配列（9,900 試合）を直接走査・集計し、以下の性質を厳密にアサート・実測しました。

- **計画総試合数 (`plannedMatches`)**: 9,900 試合
- **無順序対戦ペア数 (`pairCount`)**: 4,950 ペア ($100 \times 99 / 2$)
- **自己対戦 (`selfMatches`)**: 0 件（全 9,900 試合において `p1GenomeId !== p2GenomeId`）
- **matchIndex 連続性**: 0 から 9899 まで欠番・重複なし（厳密に連続）
- **鏡像ペア (Mirrored Pairs)**: 4,950 ペアすべてにおいて、Leg 0 と Leg 1 で P1/P2 の座席が反転し、かつ同一の `matchSeed` が付与されていることを確認。
- **全 100 個体の座席対称性**: 全個体において総対戦数 198 回、P1 割当 99 回、P2 割当 99 回が厳密に成立。
- **Canonical Schedule Digest**: `669c60e6e01f58a9097ed25e5ef090b8ed1a4df1b312e3faaa635ad02ee876c8`

---

## 7. Runtime & Performance (実測実行時間・性能)

### R1 単独実測値 (Canonical Candidate)
- **開始時刻**: `2026-10-14T09:30:32.095Z`
- **終了時刻**: `2026-10-14T09:50:28.658Z`
- **壁時計実行時間 (`wallClockElapsedMs`)**: `1,195,969.37 ms` (**19.93 分 / 1,196.0 秒**)
- **対戦実行実時間 (`matchExecutionElapsedMs`)**: `1,195,328 ms` (**19.92 分 / 1,195.3 秒**)
- **対戦処理速度 (`matchesPerSecond`)**: **8.28 matches/sec**
- **1 試合平均実行時間**: **120.7 ms/match**
- **総意思決定数 (`totalDecisions`)**: **780,786 decisions**
- **1 意思決定平均時間**: **1.53 ms/decision**
- **論理結果 SHA-256 ダイジェスト**: `fff878444b98a3c38173e92ccdbcb374b4bfe6d893724e53fd8d759419bb0069`
- **実行ステータス**: `ADVANCED`

---

## 8. Outcome Counts (対戦結果集計)

- **完走試合数 (`completedMatches`)**: **9,900 試合**
- **未完了試合数 (`incompleteMatches`)**: **0 試合**
- **例外終了試合数 (`failedMatches`)**: **0 試合**
- **総観測試合数 (`totalObservedMatches`)**: **9,900 試合**
- **完走率 (`completionRate`)**: **1.000 (100.0%)**

---

## 9. Fitness Distribution (適応度分布)

全 100 個体に対する適応度判定結果:

- **VALID 個体数**: **100 / 100 個体 (100%)**
- **INSUFFICIENT_EVIDENCE 個体数**: **0 個体**
- **INVALID 個体数**: **0 個体** (FAIL-CLOSED 条件: `INVALID === 0` を完全充足)

### VALID 個体の適応度スコア統計値

| 統計指標 | 測定値 | 備考 |
|---|---|---|
| **評価対象個体数 (`count`)** | 100 | 全個体 VALID |
| **最小スコア (`min`)** | 0.500 | 198試合中 99勝 99敗 |
| **最大スコア (`max`)** | 0.500 | 198試合中 99勝 99敗 |
| **平均スコア (`mean`)** | 0.500 | 完全対称性 |
| **中央値 (`median`)** | 0.500 | 完全対称性 |
| **第1四分位数 (`p25`)** | 0.500 | 完全対称性 |
| **第3四分位数 (`p75`)** | 0.500 | 完全対称性 |

※同一の Zero Decision DNA 同士の対戦かつ Double Round Robin（Leg 0/Leg 1 座席反転）であるため、数学的対称性により全個体が勝率 0.500 に収束しています。これは AI 強度を示すものではなく、スケールパイプラインの計算整合性を実証するものです。

---

## 10. Readiness (選択事前判定)

- **`readiness.status`**: `"READY"`
- **`readiness.validCount`**: `100`
- **`readiness.requiredCount`**: `3` ($\max(\text{minimumValidPopulationCount: 2}, \text{tournamentSize: 3}) = 3$)
- **事前判定判定**: $\text{validCount} = 100 \ge \max(3, \text{eliteCount: 1})$ を完全に満たし、次世代構築へ安全に進出。

---

## 11. Generation Transition (世代交代遷移)

- **`status`**: `"ADVANCED"`
- **元世代 (`sourceGeneration`)**: `0`
- **新世代 (`targetGeneration`)**: `1`
- **次世代母集団サイズ (`nextPopulation.entries.length`)**: `100`
- **エリート選出数 (`eliteCount`)**: `1`
- **子個体生成数 (`offspringCount`)**: `99`
- **一意性・規約検証**:
  - 全 100 個体の `genomeId` が一意（重複 0 件）: **PASS**
  - 全 100 個体の `dnaRef` が規約通り `genome:<genomeId>`: **PASS**
  - 全 100 個体の `generation` が `1`: **PASS**
- **`buildResult` 存在**: **YES (PRESENT)**

---

## 12. Memory Endpoint Snapshots (メモリ診断スナップショット)

実行直前および実行直後の `process.memoryUsage()` スナップショット:

| メトリクス | 実行直前 (Before) | 実行直後 (After) | 差分 (Delta) |
|---|---|---|---|
| **RSS (Resident Set Size)** | 200,654,848 bytes (~191 MB) | 365,568,000 bytes (~349 MB) | +164,913,152 bytes (~157 MB) |
| **Heap Used** | 71,649,088 bytes (~68 MB) | 227,437,192 bytes (~217 MB) | +155,788,104 bytes (~149 MB) |
| **Heap Total** | 108,404,736 bytes (~103 MB) | 267,374,592 bytes (~255 MB) | +158,969,856 bytes (~152 MB) |

> [!IMPORTANT]
> **メモリ診断に関する限定表明 (Mandatory Scope Limitation)**:
> 上記の記録は `GenerationRunner.run()` の直前・直後におけるエンドポイント・スナップショット（endpoint snapshots only）に過ぎません。
> 本記録は、ピークメモリ（peak memory）、GC発生頻度（GC frequency）、GC負荷（GC pressure）、またはメモリリークの不存在（absence of memory leaks）を証明するものではありません。

---

## 13. Performance Comparison & Provenance (性能比較とベンチマーク位置づけ)

3 つの記録の比較:

| 比較対象 | 対戦処理速度 | 9,900試合所要時間 | 評価・位置づけ |
|---|---|---|---|
| **A. $N=6$ Controlled 外挿見込み** | 9.27 〜 9.67 matches/sec | 17.28 〜 17.80 分 | 参考線形外挿値 (EXTRAPOLATED ESTIMATE ONLY) |
| **B. V1 Preliminary Result** | 8.20 matches/sec | 20.13 分 (1,207.6 秒) | 初回スケール走行結果 (PRELIMINARY / HISTORICAL) |
| **C. V1-R1 Canonical Candidate** | **8.28 matches/sec** | **19.93 分 (1,196.0 秒)** | **単独凍結実測値 (CANONICAL CANDIDATE PENDING REVIEW)** |

### 差分分析
- **R1 vs V1 Preliminary**: -0.20 分 (-12.0 秒、約 1.0% の微増速)
- **R1 vs $N=6$ 外挿見込み**: +2.39 分 (比率 1.14x)
- **性能評価ラベル**: **`FAST`** (実測 19.93 分: 基準 `<= 20 min` を充足)

---

## 14. 受託済みモジュールの完全無変更監査 (Zero Diff Audit)

本スケールエビデンス取得にあたり、受託済みのすべての本番モジュールおよび先行エビデンス成果物に対して 1 行の変更も加えていないことを確認しました。

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
  tools/simulator/src/engine/session/GameSession.ts \
  tools/simulator/src/engine/regulation/OfficialRegulationMatchFactory.ts \
  tools/simulator/src/engine/regulation/OfficialRegulationMatchSetup.ts \
  tools/simulator/src/cli/generationRunnerControlledEvidence.ts \
  tools/simulator/docs/ai-generation-runner-controlled-evidence-v1.md
(0 diff - completely empty)
```

---

## 15. Tests & Verification (回帰テスト検証)

ベンチマーク完了後、Docker コンテナ内にて回帰テストスイートを実行・確認しました。

1. **`generationRunner.test.ts`**: PASS (60 passed)
2. **`architectureBoundary.test.ts`**: PASS (5 passed)
3. **`npm run playable:check`**: PASS
4. **`npm run build` (`tsc && vite build`)**: PASS
5. **Full Simulator Regression (`npm test`)**: PASS (200 test files, 2,705 tests passed)

---

## 16. Interpretation & Limitations (主張の限定)

### 実証された事項（PROVEN）
- 公式 `light-entry16` レギュレーションにおいて、本番パイプライン（Official Regulation $\to$ Official Match Setup $\to$ GameSession $\to$ GenomePolicy $\to$ SimulationRunner $\to$ GenerationRunner.aggregateOutcomes $\to$ FitnessEvaluator $\to$ PopulationSelector $\to$ GenerationBuilder）が $N=100$, 9,900 試合を Sequential V1 で完走できること。
- 9,900 試合が約 19.93 分（8.28 matches/sec）で単独処理可能であること。
- 9,900 試合全戦において勝敗保存則、試合数保存則、座席対称性が厳密に成立すること。
- 有効個体数判定に基づき、Generation 0 から Generation 1 への次世代母集団生成（$N=100$）が完全に成立すること。

### 実証されていない事項（NOT PROVEN）
- 並列実行スケーリング（Worker Threads, multi-process）
- Master + Extra など他のレギュレーションでのスケール性
- 複数世代にわたる長期進化ループ（Evolution Loop: 100 世代等）
- AI ポリシーの定量的強度向上（Strength Improvement）
- 殿堂入り（Hall of Fame）メカニズム
- 長期的な収束性や多様性維持

---

## 17. 最終結論

本 N=100 One-Generation Scale Evidence V1-R1 は、残存プロセス0件の完全静穏環境およびハーネス凍結下において、1回限りの単独実機走行により 9,900 試合の全戦正常完走（COMPLETED）、厳密な保存則成立、適応度計算・事前判定・次世代母集団生成（Generation $g=0 \to 1$）、および実測 19.93 分（8.28 matches/sec）を実証しました。

最終ステータス:
**READY FOR INDEPENDENT REVIEW**
