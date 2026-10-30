# BlackPoker Simulator 第9.2版コアフロー再基準測定エビデンス報告書 (R1)

**Work ID**: `BP-SIM-AI-V92-BASELINE-EVIDENCE-V1-R1`<br>
**日付**: 2026-10-30<br>
**対象リポジトリ**: `BlackPoker/BlackPoker`<br>
**対象ブランチ**: `BlackPoker/issue551-core-flow`<br>
**Start SHA**: `b0949612dbd7c84ef293e4dfdbefc8dc14dff09d`<br>
**ステータス**: **READY FOR INDEPENDENT REVIEW**

---

## 1. 目的

第9.2版公式ルール（フォーカス方式、ルールシステムによるチャンス保持 `system`、ステージトップ1件ずつの解決）が統合されたBlackPoker Simulatorにおいて、既存のDecision DNA / GenomePolicy / GenerationRunner / EvolutionLoopの挙動を再評価し、Controlled Evidenceとしての再現性と測定結果の厳密性を補完・確立する。

本作業はAIポリシーの改良ではなく、現状基盤の再基準測定（Re-evaluation Baseline Measurement）および厳密な再現性検証である。

---

## 2. Feature Compatibility Audit（特徴量・フィンガープリント互換性監査）

### 2.1 DecisionFeatureEncoder Schema v5 の監査結果
- **調査対象**: `src/engine/ai/DecisionFeatureEncoder.ts` (Schema Version 5, Context 163次元, Pattern 143次元, 計 23,452 weights)
- **結果**: `PlayerObservation.focusPlayerId` は、コンテキスト特徴量（163次元）およびパターン特徴量（143次元）のいずれにおいても参照されていない。
- **実証検証**: `focusPlayerId` のみが異なる2つの `DecisionRequest` を入力した際、出力される数値ベクトルは100%同一（差分なし）。
- **Compatibility Gap**: 第9.2版コアフローで導入された `focusPlayerId` がAIポリシーへの特徴量入力として届いていない。自手番でフォーカスを保持しているかどうかの情報が特徴量上区別できない。

### 2.2 Semantic Fingerprint の focus 感度監査
`SemanticFingerprintCalculator.ts` における各フィンガープリントの感度を実機検証した結果：

| フィンガープリント | 対象 | focus感度 | 監査結果と要因 |
|---|---|:---:|---|
| `sgf1` | 盤面構造 + Side State (Turn-Aware) | **あり** | `extractStructuralProjection` 内で `state.focusPlayer` を明示的に含んでいるため、フォーカス変更でハッシュが変化する（正常）。 |
| `sgf1-ti` | 盤面構造 + Side State (Turn-Invariant) | **あり** | `extractStructuralProjection` 内で `state.focusPlayer` を含んでいるため、フォーカス変更でハッシュが変化する（正常）。 |
| `pof1` | PlayerObservation (合法的観測) | **なし (Gap)** | `extractObservationProjection` の射影結果に `focusPlayerId` が含まれていないため、フォーカス変更に対して不感。 |
| `drsf1` | DecisionRequest (判断要求意味論) | **なし (Gap)** | `extractObservationProjection` を埋め込んでおり、`focusPlayerId` が除外されているため不感。 |
| `gpif1` | GenomePolicy Input (特徴量数値射影) | **なし (Gap)** | `DecisionFeatureEncoder` が `focusPlayerId` を参照しないため、数値ベクトルが不変となり不感。 |

---

## 3. Baseline A: Core / AI Compatibility（第9.2版コア互換性契約）

Evidence Runner が直接検証した契約と、既存回帰テストスイートに依拠する契約の境界を明確に区別して整理する。

### 3.1 Evidence Runner による直接検証項目
`OfficialRegulationMatchFactory` 経由の `official:light-entry16` 実ゲームセッションを用いて直接検証：

1. **focusPlayer 初期化契約**: `session.advance()` 到達時点で `focusPlayer === turnPlayer` に正しく初期化される（検証結果: `true`）。
2. **空Stage PASS 排除契約**: ステージが空（`stage.requests.length === 0`）の盤面において、合法パターン一覧に `PASS` は含まれない（検証結果: `true`）。
3. **Snapshot V2 契約**: `focusPlayer` を完全に保持し、シリアライズ $\rightarrow$ デシリアライズ $\rightarrow$ セッション復元で `focusPlayer` が100%正しく復元される（検証結果: `true`）。
4. **Snapshot V1 明示的拒絶契約**: `focusPlayer` を欠損する旧V1スナップショットは `GameSessionSnapshotValidationError` により fail-fast で明示的に拒絶される（検証結果: `true`）。
5. **受動的診断器パリティ契約**: `enableSemanticDiagnostics: false` vs `true` において、`completed`, `winner`, `reason`, `totalDecisions`, `turnCount`, `finalStateHash`, `decisionTrace` が100%完全一致する（検証結果: `true`）。

### 3.2 既存 Core Flow 回帰テストスイートに依拠する間接検証項目
以下の契約は、既存の自動テストスイートによって検証されていることを確認した：

- **Stage非空時の PASS 処理**: ステージにリクエストが存在する場合に PASS を選択可能であり、連続パスでチャンスが遷移すること（依拠テスト: `src/tests/decision/coreFlow.test.ts`）。
- **ルールシステムによるチャンス保持と解決**: `chancePlayer === "system"` となり、ステージトップ1件のみが解決されること（依拠テスト: `src/tests/rules-vnext/turnChance.test.ts`）。
- **効果解決時選択（EFFECT_SELECTION）**: `chancePlayer === "system"` 下でもダメージ判定等の効果選択要求が正常に完了すること（依拠テスト: `src/tests/decision/resolutionTargetValidation.test.ts`）。
- **エンド・チャージ・ドローの自律サイクル**: エンド解決 $\rightarrow$ チャージ即時解決 $\rightarrow$ ドロー積載 $\rightarrow$ ターン交代の遷移が正常に完走すること（依拠テスト: `src/tests/rules-vnext/endChargeDrawChance.test.ts`, `src/cli/scenarioRunner.ts` シナリオ8）。

---

## 4. Baseline B: N=6 Controlled Evolution（新基準測定結果）

### 4.1 測定条件
- **Regulation**: `official:light-entry16`
- **母集団規模**: $N = 6$
- **反復回数**: $R = 1$ (Double Round Robin, 30試合/世代)
- **Campaign Seed**: 42
- **maxDecisions**: 500
- **初期世代 (g0)**: 6 Zero Decision DNA

### 4.2 試合結果および観測された関連（Observed Association）
旧コアフロー環境では **2 COMPLETED / 28 INCOMPLETE** で世代交代が停止（`REEVALUATION_REQUIRED`）していたが、第9.2版コアフロー環境下での測定結果は以下の通りである：

| 世代 | 総試合数 | COMPLETED | INCOMPLETE | FAILED | DRAW | decisions 範囲 | Runner Status |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **g0** | 30 | **30 (100%)** | **0 (0%)** | 0 | 0 | min 36, max 88, avg 77.73, median 85 | **ADVANCED** |
| **g1** | 30 | **30 (100%)** | **0 (0%)** | 0 | 0 | min 4, max 84, avg 49.33, median 52 | **ADVANCED** |

- **決着理由**: 全試合「相手のライフが0になりました」（ライフ枯渇による正常決着、DRAW 0件）。
- **観測された関連（Observed Association）**: 第9.2版コアフローの適用（空ステージでのPASS禁止、フォーカスおよびルールシステムによるステージ1件ずつの解決フロー）と同時に、`light-entry16` において30試合すべてが上限（500）に達することなく決着し、完了率100%および世代交代（`ADVANCED`）への進行が観測された。
- *※注意: 本結果は `light-entry16` における観測事実であり、空Stage PASS禁止のみが完了率改善の単一原因であると断定するものではなく、また全レギュレーションでの無限ループ完全解消や強いDNAの完成を保証するものではない。*

### 4.3 g0 -> g1 Run A vs Run B 独立再構築・決定論的検証
既存Production経路を用いて、同一条件（Campaign Seed 42）から Run A と Run B を完全に独立して再構築・実行し、全項目の一致を検証した：

1. **Genome IDs**: g0, g1 ともに全6個体の ID 系列が完全一致。
2. **DNA 全重み & DNA Digest**:
   - g0: 6個体すべて 23,452 weights, `fullDnaDigest` が完全一致。
   - g1: 6個体すべて 23,452 weights, `fullDnaDigest` が完全一致。
3. **対戦スケジュール**: matchIndex, pairIndex, repetitionIndex, legIndex, p1GenomeId, p2GenomeId, matchSeed が 30 試合すべて完全一致。
4. **試合 Outcome**: completed, winner, reason, totalDecisions, turnCount, finalStateHash が 30 試合すべて完全一致。
5. **Decision Trace Logical Projection & Digest**:
   - `runtimeDecisionId` や timestamp などの実行時動的情報を除外し、決定論的フィールド（`stepCount`, `logicalDecisionId`, `playerId`, `stateVersion`, `stateHash`, `selectedPatternRef`, `selectedLogicalPatternKey`, `selectedPatternKind`, `actionId`, `legalPatterns`）からなる logical projection を構築。
   - per-match SHA-256 digest を算出して比較した結果、**30 試合すべて Run A == Run B で 100% 一致**。
6. **Fitness Snapshot**: 全個体の status, fitnessScore, completedMatches, completionRate, scheduledMatches, wins, losses, draws が完全一致。
7. **論理マニフェスト**: generationSeed, evaluationScheduleId, seedScheduleIdentity が完全一致。
8. **Generation Status**: g0 `ADVANCED`, g1 `ADVANCED` が完全一致。

### 4.4 Fitness 保存則（Fitness Conservation Laws）の検証
全30試合の Outcome と、母集団全個体の適応度集計値との数学的整合性を検証：

- $\sum \text{wins} = 30$（決着試合数 30 と完全一致）
- $\sum \text{losses} = 30$（決着試合数 30 と完全一致）
- $\sum \text{draws} = 0$（引き分け試合数 0 と完全一致）
- $\sum \text{completedMatches} = 60$（$2 \times 30$ 試合と完全一致）
- 各個体の $\text{wins} + \text{losses} + \text{draws} = \text{completedMatches}$（全個体で成立）
- 各個体の $\text{scheduledMatches} = 10$（全個体で成立）
- `INCOMPLETE != DRAW` の厳密な区別が維持されていることを確認。

---

## 5. Standard + Pack Smoke Test 結果（分類の厳密化）

- **Regulation**: `official:standard-pack`
- **対戦数**: 4試合 (Seeds: 101, 202, 303, 404)
- **AI Policy**: Zero Decision DNA vs Zero Decision DNA
- **maxDecisions**: 200
- **結果分類**:
  - `completedMatchesCount`: **0**
  - `incompleteMatchesCount`: **4**
  - `exceptionMatchesCount`: **0**
  - `allRunsWithoutException`: **true**
- **詳細分析と注記**:
  - 全4試合において未捕捉例外・実行時エラーは 0 件であり、シミュレータ基盤は安全に稼働した。
  - 全4試合が 200 decisions に到達し、`reason: "最大判断回数 (200) に到達しました。"` により `completed: false`（INCOMPLETE）として安全停止した。
  - **注記**: Standard + Pack はデッキ規模（32枚＋パックカード）が大きく、防壁や手札の選択肢が豊富なため、初期の Zero DNA ポリシーでは 200 decisions 以内にライフ枯渇に至らなかった。この結果は**決定回数上限による時間切れであり、無限ループやバグ、あるいはポリシーの強さ不足を証明するものではない**。

---

## 6. 次に必要な Feature Schema 改訂計画（提言）

本監査で実証された Compatibility Gap を解消するため、次のAI開発ワークにおいて以下の改訂を推奨する：

1. **Feature Schema v6 策定**:
   - `DecisionFeatureEncoder` に `selfIsFocus` (1/0), `oppIsFocus` (1/0) の2次元を追加（Context次元数を 163 $\rightarrow$ 165 へ拡張）。
   - これにより、GenomePolicy が「自身が現在フォーカスを保持しているか」をスコアリングに反映可能とする。
2. **Semantic Fingerprint のフォーカス同期**:
   - `SemanticFingerprintCalculator.extractObservationProjection` に `focusPlayerId: obs.focusPlayerId` を追加。
   - これにより、`pof1`, `drsf1`, `gpif1` がフォーカスの変化を意味論的に正しく捕捉可能とする。

---

## 7. 既知の限界事項 (Known Limitations)

1. **Feature Schema v5 のフォーカス不感性**: 現行の Schema v5 では AI がフォーカス状態をベクトルとして知覚できない（Feature Schema v6 での対処が必要）。
2. **Observation Fingerprint のフォーカス不感性**: `pof1`, `drsf1`, `gpif1` はフォーカス変更でハッシュが変化しない。
3. **Standard + Pack での判断上限到達**: 200 decisions では決着に至らず INCOMPLETE となるため、より大きな決定回数上限または学習済み DNA による検証が必要。

---

## 8. 結論

第9.2版コアフローのもとで、`light-entry16` における N=6 制御進化（g0 $\rightarrow$ g1）の100%完了および世代前進が観測され、Run A / Run B の独立再構築による決定論的同一性が厳密に実証された。また、現行の Feature Schema v5 および Fingerprint における Compatibility Gap が正確に同定された。

本エビデンスをもって、独立レビュー準備完了（**READY FOR INDEPENDENT REVIEW**）とする。
