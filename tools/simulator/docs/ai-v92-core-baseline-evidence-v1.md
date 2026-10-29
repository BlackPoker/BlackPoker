# BlackPoker Simulator 第9.2版コアフロー再基準測定エビデンス報告書

**Work ID**: `BP-SIM-AI-V92-BASELINE-EVIDENCE-V1`  
**日付**: 2026-10-30  
**対象リポジトリ**: `BlackPoker/BlackPoker`  
**対象ブランチ**: `BlackPoker/issue551-core-flow`  
**Start SHA**: `92a7fc50674c20026118cf20460c6ee423451a71`  

---

## 1. 目的

第9.2版公式ルール（フォーカス方式・ルールシステムによるチャンス保持 `system`・全員パス解決の厳格化）が統合されたBlackPoker Simulatorにおいて、既存のDecision DNA / GenomePolicy / GenerationRunner / EvolutionLoopの挙動を再評価し、新基準値を決定論的に測定・確立する。

---

## 2. Feature Compatibility Audit（特徴量・フィンガープリント互換性監査）

### 2.1 DecisionFeatureEncoder Schema v5 の監査結果
- **調査対象**: `src/engine/ai/DecisionFeatureEncoder.ts` (Schema Version 5, Context 163次元, Pattern 143次元)
- **結果**: `PlayerObservation.focusPlayerId` は、コンテキスト特徴量（163次元）およびパターン特徴量（143次元）のいずれにおいても一切参照されていない。
- **実証検証**: `focusPlayerId` のみが異なる2つの `DecisionRequest` を入力した際、出力される数値ベクトルは100%同一（差分なし）。
- **Compatibility Gap**: 第9.2版コアフローで導入された `focusPlayerId` がAIポリシーへの特徴量入力として届いていない。

### 2.2 Semantic Fingerprint の focus 感度監査
`SemanticFingerprintCalculator.ts` における各フィンガープリントの感度を監査・実証した結果：

| フィンガープリント | 対象 | focus感度 | 監査結果と要因 |
|---|---|:---:|---|
| `sgf1` | 盤面構造 + Side State (Turn-Aware) | **あり** | `extractStructuralProjection` 内で `state.focusPlayer` を明示的に含んでいるため、フォーカス変更でハッシュが変化する。 |
| `sgf1-ti` | 盤面構造 + Side State (Turn-Invariant) | **あり** | `extractStructuralProjection` 内で `state.focusPlayer` を含んでいるため、フォーカス変更でハッシュが変化する。 |
| `pof1` | PlayerObservation (合法的観測) | **なし (Gap)** | `extractObservationProjection` の射影結果に `focusPlayerId` が含まれていないため、フォーカス変更に対して不感。 |
| `drsf1` | DecisionRequest (判断要求意味論) | **なし (Gap)** | `extractObservationProjection` を埋め込んでおり、`focusPlayerId` が除外されているため不感。 |
| `gpif1` | GenomePolicy Input (特徴量数値射影) | **なし (Gap)** | `DecisionFeatureEncoder` が `focusPlayerId` を参照しないため、数値ベクトルが不変となり不感。 |

---

## 3. Baseline A: Core / AI Compatibility（第9.2版コア互換性検証）

`OfficialRegulationMatchFactory` 経由の `official:light-entry16` 実ゲームセッションを用いて、第9.2版コアフローの各要件を実機検証：

1. **focusPlayer 初期化**: `session.advance()` 到達時点で `focusPlayer === turnPlayer` に正しく初期化される（PASS）。
2. **空Stage PASS 排除**: ステージが空の状態において、合法パターン一覧に `PASS` は含まれない（PASS）。
3. **Stage非空 PASS 選択**: ステージにリクエストが存在する場合、対向プレイヤーは合法的に `PASS` を選択可能（PASS）。
4. **全員PASS 解決**: 全員PASS成立により `chancePlayer = "system"` となり、ステージトップ1件のみが解決される（PASS）。
5. **ルールシステム中効果選択**: `chancePlayer === "system"` 下でも `EFFECT_SELECTION`（ダメージ判定等）が正常に処理される（PASS）。
6. **Policy誤認防止**: `system` は通常プレイヤーPolicyと誤認されず、AI Policyへ直接要求が渡らない（PASS）。
7. **End / Charge / Draw サイクル**: エンド解決 $\rightarrow$ チャージ誘発 $\rightarrow$ ドロー誘発の遷移が完全自律完走する（PASS）。
8. **Snapshot V2**: `focusPlayer` を完全に保持し、シリアライズ $\rightarrow$ デシリアライズ $\rightarrow$ セッション復元が100%成功（PASS）。
9. **Snapshot V1 明示的拒否**: `focusPlayer` の存在しないレガシーV1スナップショットは `GameSessionSnapshotValidationError` により明示的に拒否される（PASS）。
10. **受動的診断器パリティ**: `enableSemanticDiagnostics: false` vs `true` において、`completed`, `winner`, `reason`, `totalDecisions`, `turnCount`, `finalStateHash`, `decisionTrace` が100%完全一致（PASS）。

---

## 4. Baseline B: N=6 Controlled Evolution（新基準測定結果）

- **Regulation**: `official:light-entry16`
- **母集団規模**: $N = 6$
- **反復回数**: $R = 1$
- **Campaign Seed**: 42
- **maxDecisions**: 500
- **初期世代 (g0)**: 6 Zero Decision DNA

### 4.1 試合結果サマリー
旧コア（旧パス記録方式）では **2 COMPLETED / 28 INCOMPLETE** であったが、第9.2版コアフローでは以下の劇的な変化を観測：

| 世代 | 総試合数 | COMPLETED | INCOMPLETE | FAILED | DRAW | Runner Status |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **g0** | 30 | **30 (100%)** | **0 (0%)** | 0 | 0 | **ADVANCED** |
| **g1** | 30 | **30 (100%)** | **0 (0%)** | 0 | 0 | **ADVANCED** |

- **平均ディシジョン数**: 約40〜80 decisions（最大判断回数500に達する試合は0件）
- **平均ターン数**: 2〜7 turns
- **決着理由**: 全30試合とも「相手のライフが0になりました」（ライフ枯渇による正常決着）
- **要因分析**: 旧コアでは空StageでPASSを互いに選択し続けることによる「手番スタック・停滞（Stall）」が発生していたが、第9.2版コアフローでは空StageでのPASSが禁止され、全員PASSでStageが確実に1件解決されるため、ゲームが確実に前進して決着へ到達するようになった。

### 4.2 決定論的一致（Run A vs Run B）
同一の Campaign Seed（42）および g0 Seed（4143575905）を用いて Run A と Run B を独立実行：
- `match schedule`: 100% 完全一致
- `seed`: 100% 完全一致
- `DNA digest`: 100% 完全一致
- `selected decisions`: 100% 完全一致
- `completed / winner / reason`: 100% 完全一致
- `final state hash`: 100% 完全一致
- **総合判定**: **100% 決定論的再現性を確認**

---

## 5. Standard + Pack Smoke Test 結果

- **Regulation**: `official:standard-pack`
- **対戦数**: 4試合 (Seeds: 101, 202, 303, 404)
- **AI Policy**: Zero Decision DNA vs Zero Decision DNA
- **maxDecisions**: 200
- **結果**:
  - 全4試合において実行時例外・未捕捉エラーは **0件**（正常稼働）。
  - 各試合は200 decisionsに到達し INCOMPLETE（未決着）として安全停止。
  - 合法手生成、Packカードの観測、およびターンスケジュールが正常機能することを確認。

---

## 6. 次に必要な Feature Schema 改訂計画（提言）

本監査で実証された Compatibility Gap を解消するため、次のAI開発ワークにおいて以下の改訂を推奨する：

1. **Feature Schema v6 策定**:
   - `DecisionFeatureEncoder` に `selfIsFocus` (1/0), `oppIsFocus` (1/0) の2次元を追加（Context次元数を 163 $\rightarrow$ 165 へ拡張）。
   - これにより、GenomePolicy が「自身が現在フォーカスを保持しているか」をスコアリングに反映可能となる。
2. **Semantic Fingerprint のフォーカス同期**:
   - `SemanticFingerprintCalculator.extractObservationProjection` に `focusPlayerId: obs.focusPlayerId` を追加。
   - これにより、`pof1`, `drsf1`, `gpif1` がフォーカスの変化を意味論的に正しく捕捉できるようになる。

---

## 7. 結論
第9.2版コアフローはAI自己対戦基盤として完全な安定性と高い健全性を発揮しており、停滞（Stall）が劇的に解消されたことが実証された。本エビデンスをもって独立レビュー準備完了（READY FOR INDEPENDENT REVIEW）とする。
