# BlackPoker Simulator - AI Feature Schema v6 設計仕様書 V1

**作業ID**: `BP-SIM-AI-V92-FEATURE-SCHEMA-V6-DESIGN-V1`
**設計ステータス**: DESIGNED / READY FOR INDEPENDENT REVIEW
**先行作業**: `BP-SIM-AI-V92-BASELINE-EVIDENCE-V1-R2` (FORMAL ACCEPTED, Commit: `363322421cc3a475db89bd61c8a4ec5e3b21d039`)
**コアベースライン**: 第9.2版コアフロー (Commit: `92a7fc50674c20026118cf20460c6ee423451a71`)
**対象ブランチ**: `BlackPoker/issue551-core-flow`
**Canonical Registry**: `docs/ai-v92-feature-schema-v6-registry-v1.json`
**更新日時**: 2026-10-30 JST

---

## 1. Document Identity & Formal Baseline

### 1.1 目的 (Purpose)

本仕様書は、BlackPoker 第9.2版コアフローにおいて導入された `focusPlayer`（フォーカスプレイヤー）状態を、AI の意思決定モデル（Decision Feature Schema）へ正式に統合するための **Feature Schema v6** のアーキテクチャおよび詳細仕様を策定する Canonical Design Artifact です。

第9.2版コアフローでは、パス権の連続解決およびステージ解決開始時における「ルールシステムへのチャンス移動 (`chancePlayer === "system"`)」に伴い、現在どのプレイヤーが主導権（フォーカス）を保持しているか、または解決後に誰へフォーカスが戻るかが `state.focusPlayer` として明確に管理されるようになりました。
しかし、現行の Feature Schema v5 では `obs.turnPlayerId` および `obs.chancePlayerId` のみが特徴量化されており、`obs.focusPlayerId` は一切エンコードされていませんでした（Feature Dimension Gap）。

本設計では、このギャップを解消し、AI がフォーカス状態を合法的な観測情報として識別できるようにすると同時に、既存の学習済み Decision DNA との完全な後方互換性・スコア不変性を数学的に保証する移行契約を定義します。

### 1.2 設計限定原則 (Design Only Boundary)

本作業は **DESIGN ONLY** です。
- **本番コード修正の禁止**: `src/engine/**`, `src/domain/**`, `src/data/**` への変更は行いません（本番 diff: 0）。
- **DNA 移行・自己対戦・進化実行の禁止**: Feature Schema v6 の実装、DNA 移行スクリプトの実行、および新規進化ループの実行は本作業のスコープ外です。
- **成果物範囲**:
  1. 設計仕様書: `tools/simulator/docs/ai-v92-feature-schema-v6-design-v1.md`（本文書）
  2. Canonical Registry ドラフト: `tools/simulator/docs/ai-v92-feature-schema-v6-registry-v1.json`
  3. ロードマップ更新: `tools/simulator/docs/ai-self-play-roadmap.md`

### 1.3 前提ベースライン (Formal Baseline)

- **Core Flow**: 第9.2版コアフロー（フォーカス方式、パス判定統合、全員パス時 chancePlayer="system" 移行、Commit: `92a7fc50674c20026118cf20460c6ee423451a71`）
- **AI Controlled Evidence**: `BP-SIM-AI-V92-BASELINE-EVIDENCE-V1-R2`（FORMAL ACCEPTED, Commit: `363322421cc3a475db89bd61c8a4ec5e3b21d039`）
  - Official `light-entry16`, N=6, R=1, maxDecisions=500:
    - Generation 0: 30/30 matches COMPLETED (100.0%)
    - Generation 1: 30/30 matches COMPLETED (100.0%)
  - Official `standard-pack`, Zero DNA, 4 matches, maxDecisions=200:
    - 0/4 COMPLETED, 4/4 INCOMPLETE (maxDecisions 到達)

---

## 2. 現状アーキテクチャとギャップ監査 (Current Architecture & Gap Audit)

### 2.1 Feature Schema v5 の現状仕様

現行の Feature Schema v5 (`FEATURE_SCHEMA_VERSION = 5`) は以下の次元構成を持ちます：

- **Context Feature 次元数**: 163 次元 (`CONTEXT_FEATURE_DIMENSION = 163`)
  - 1. Decision Context: 8次元 (`source_is_action_request`, `self_is_turn_player`, `self_is_chance_player`, `opponent_is_turn_player`, `opponent_is_chance_player`, etc.)
  - 2. Legal Pattern Counts & Actionability: 11次元
  - 3. Self - Life & Hand: 18次元
  - 4. Self - Field, Trumps, Fog & Grave: 17次元
  - 5. Opponent - Life & Hand: 10次元
  - 6. Opponent - Field, Trumps, Fog & Grave: 16次元
  - 7. Relative Board Balance: 20次元
  - 8. Request Context (Viewer Relative): 63次元
- **Pattern Feature 次元数**: 143 次元 (`PATTERN_FEATURE_DIMENSION = 143`)
- **総特徴量数**: $163 + 143 = 306$ 次元
- **相互作用重み次元数 (Interaction Weights)**: $163 \times 143 = 23,309$ 次元
- **DNA 総重み次元数 (Total Decision DNA Weights)**: $143 + 23,309 = 23,452$ 次元

### 2.2 第9.2版コアフローとの Gap 分析

第9.2版コアフローへの改定により、状態遷移と観測モデルに以下の変化が生じました：

1. **`focusPlayer` の導入**:
   - `state.focusPlayer`: 現在のフォーカスを保持するプレイヤーキー (`"p1" | "p2"`)。
   - `chancePlayer` が `"system"`（ルールシステムがステージ解決を実行中）である間も、`focusPlayer` は最後にフォーカスを保持していた（または解決後にフォーカスを受け取る）プレイヤーを保持します。
   - `ObservationFactory.ts` において、`PlayerObservation.focusPlayerId` として `state.focusPlayer` がすでにサニタイズされた合法観測情報として提供されています。
2. **`DecisionFeatureEncoder.ts` の不感性 (Encoder Blindness)**:
   - `encodeContext` において、`obs.turnPlayerId` と `obs.chancePlayerId` は読み取られていますが、`obs.focusPlayerId` は一切参照されていません。
   - その結果、AI プレイヤーから見て「自分がフォーカスを持っているか」「相手がフォーカスを持っているか」が数値特徴量として完全に失われており、状況判断ベクトルが同一になってしまいます。
3. **Semantic Fingerprint の不整合 (Fingerprint Gap)**:
   - 盤面構造フィンガープリント (`sgf1`, `sgf1-ti`) は `state.focusPlayer` を含んでおり、フォーカスの移動に感度を持ちます。
   - しかし、観測フィンガープリント (`pof1`)、判断要求フィンガープリント (`drsf1`)、ポリシー入力フィンガープリント (`gpif1`) の3つは `focusPlayerId` を射影から除外しているため、フォーカス移動に対して完全に不感（ブラインド）となっています。

---

## 3. Feature Schema v6 フォーカス特徴量仕様 (Focus Feature Specification)

### 3.1 追加特徴量の定義

Feature Schema v6 では、Context 特徴量の末尾に以下の 2 つのバイナリ特徴量を追加します：

| Index | 特徴量名 (`name`) | 型 (`rawSemanticType`) | 定義式 (`rawFormulaSummary`) | 値域 (`rawDomain`) | スケーリング関数 | スケール後値域 |
|:---:|:---|:---:|:---|:---:|:---:|:---:|
| **163** | `self_is_focus_player` | `BOOLEAN_FLAG` | `observation.focusPlayerId === viewerPlayerId ? 1 : 0` | $\{0, 1\}$ | `identity` | $[0, 1]$ |
| **164** | `opponent_is_focus_player` | `BOOLEAN_FLAG` | `observation.focusPlayerId !== undefined && observation.focusPlayerId !== viewerPlayerId ? 1 : 0` | $\{0, 1\}$ | `identity` | $[0, 1]$ |

### 3.2 2変数分離設計の技術的根拠 (Why Two Features?)

単一のフラグ（例: `self_is_focus` の 0/1）ではなく、`self_is_focus_player` と `opponent_is_focus_player` の 2 つの特徴量に分離する理由は以下の通りです：

1. **プレイヤー視点鏡像対称性 (Viewer-Relative Symmetry)**:
   - 既存の `self_is_turn_player` / `opponent_is_turn_player`、および `self_is_chance_player` / `opponent_is_chance_player` の設計原則に厳格に準拠します。
   - 座席（p1/p2）に依存せず、常に「自分視点」での対称性が保証されます。
2. **未割り当て・安全デフォルト状態の安全な表現 (Safe Neutral Handling)**:
   - 試合初期化前、観測情報のサニタイズ異常、あるいは将来の拡張において `focusPlayerId` が未定義 (`undefined`) となるエッジケースが存在し得ます。
   - 2変数設計であれば、未定義時は両方とも `0` となり、「中立・不明」を自然に表現できます。単一フラグの場合、「0」が「相手がフォーカスを持つ」のか「中立」なのかを区別できません。
3. **線形相互作用重みの独立学習能力 (Independent Weight Expressiveness)**:
   - Decision DNA の相互作用行列において、AI は「自分がフォーカスを持っているときの特定アクションへのボーナス ($M_{163, j}$)」と、「相手がフォーカスを持っているときの迎撃・防御アクションへのボーナス ($M_{164, j}$/Pass考慮)」を独立した実数値として学習できます。
   - 単一フラグの場合、$M_{j} \times (1 - \text{is\_self})$ のような強制的な負の相関が課され、表現力が制約されます。

### 3.3 境界条件と動作セマンティクス

1. **通常の手番・チャンス保有時**:
   - ターンプレイヤーが行動可能な状態では、通常 `focusPlayer === turnPlayer` です。
   - `self_is_focus_player = 1`, `opponent_is_focus_player = 0`（自分が手番の場合）。
2. **相手の即時アクション割り込み時**:
   - 相手がアクションを宣言しフォーカスが移動した場合、`self_is_focus_player = 0`, `opponent_is_focus_player = 1` となり、AI は自分がレスポンス側に回ったことを即座に特徴量として認識します。
3. **全員パス成立・ルールシステムへのチャンス移動時 (`chancePlayer === "system"`)**:
   - ルールシステムがステージ解決を行っている最中も、`focusPlayer` はフォーカスを保持していたプレイヤー（または解決後にフォーカスを受け取るプレイヤー）を指します。
   - AI は「チャンスが system にあるが、フォーカスは誰が持っているか」を正確に認識できます。
4. **観測情報のサニタイズ時**:
   - 観測情報に `focusPlayerId` が含まれない場合は、安全に `self_is_focus_player = 0`, `opponent_is_focus_player = 0` と評価されます（Fail-Closed 原則）。

### 3.4 改定後の次元体系 (Resulting Dimensions)

- **Context Feature 次元数**: $163 + 2 = \mathbf{165}$ 次元
- **Pattern Feature 次元数**: $\mathbf{143}$ 次元（不変）
- **総特徴量数**: $165 + 143 = \mathbf{308}$ 次元（旧 306 から +2）
- **相互作用重み次元数**: $165 \times 143 = \mathbf{23,595}$ 次元（旧 23,309 から +286）
- **Decision DNA 総重み次元数**: $143 + 23,595 = \mathbf{23,738}$ 次元（旧 23,452 から +286）

---

## 4. 特徴量スケーリング仕様 (Canonical Feature Scaling Specification)

### 4.1 新規特徴量のスケーリング規則

追加される 2 つの特徴量は、純粋なバイナリブールフラグであるため、既存の Scaling Registry の `BOOLEAN` クラスに分類されます：

- **Scaling Class**: `BOOLEAN`
- **Scaling Function**: `identity` ($f(x) = x$)
- **Raw Domain**: $\{0, 1\}$
- **Scaled Output Domain**: $[0, 1]$
- **Scaling Parameter**: `{}`（パラメータなし）
- **Theoretical Bound**: $1.0$ (Known: true)
- **Zero Semantic**: 「条件不成立（フォーカスを保持していない、または未定義）」

### 4.2 数学的有界不変条件の保持 (Bounded Invariant Preservation)

Feature Schema v5 で確立されたスケーリング不変条件：
$$c_i \in [-1, 1] \quad (\forall i \in [0, 164])$$
$$p_j \in [-1, 1] \quad (\forall j \in [0, 142])$$
$$|c_i \cdot p_j| \le 1.0 \quad (\forall i, j)$$

新規特徴量 $c_{163}, c_{164} \in \{0, 1\} \subset [0, 1]$ は本有界条件を完全に満たし、DNA 突然変異時の重み増幅（Mutation Amplification）を引き起こさないことが保証されます。

### 4.3 Canonical Registry v6 の集計概要

`docs/ai-v92-feature-schema-v6-registry-v1.json` の確定集計値は以下の通りです：

- **全特徴量数**: 308
- **Context 特徴量数**: 165
- **Pattern 特徴量数**: 143
- **スケーリングクラス分布**:
  - `BOOLEAN`: 53 (+2)
  - `NONNEGATIVE_COUNT`: 123
  - `AGGREGATE_SUM`: 13
  - `BOUNDED_CARD_VALUE`: 10
  - `SIZE`: 11
  - `SIGNED_DELTA`: 10
  - `HASH_BUCKET`: 64
  - `ONE_HOT`: 23
  - `RATIO_0_1`: 1
- **スケーリング関数分布**:
  - `identity`: 141 (+2)
  - `saturating_rational`: 147
  - `linear_bound_division`: 10
  - `signed_saturating_rational`: 10
- **出力値域分布**:
  - `[0, 1]`: 151 (+2)
  - `[0, 1)`: 147
  - `(-1, 1)`: 10

---

## 5. Decision DNA 互換性と移行契約 (Decision DNA Compatibility & Migration Contract)

### 5.1 DNA フォーマットとスキーマバージョン

- **DNA Format Version**: `formatVersion: 1` を維持（JSON-safe DTO 構造、メタデータ検証、Row-Major 格納形式は不変）。
- **DNA Schema Version**: `schemaVersion: 6` へインクリメント。

### 5.2 Fail-Closed 拒絶契約 (Fail-Closed Legacy Rejection)

ランタイムの整合性を保護するため、暗黙的な自動アップキャストや不完全な次元での推論を禁止します：
1. **ランタイム拒絶**:
   - Feature Schema v6 環境において、`schemaVersion: 5` の DNA を直接ロードして評価しようとした場合、例外 `FeatureSchemaMismatchError` を送出して Fail-Closed に停止します。
2. **母集団内の混在禁止**:
   - 単一の世代・母集団（`PopulationSnapshot`）内に v5 と v6 の DNA が混在することを厳格に禁止します（`GenerationRunnerIntegrityError`）。

### 5.3 決定論的 DNA 移行関数 (`DecisionDNAMigration.migrateV5toV6`)

v5 DNA を v6 DNA へ安全に移行するための純粋関数を定義します：

```typescript
export class DecisionDNAMigration {
  /**
   * Schema v5 Decision DNA を Schema v6 へ決定論的に移行
   */
  public static migrateV5toV6(dnaV5: Readonly<DecisionDNA>): DecisionDNA {
    // 1. 入力バリデーション
    if (dnaV5.schemaVersion !== 5) {
      throw new Error(`Migration source must be schemaVersion 5, got ${dnaV5.schemaVersion}`);
    }
    DecisionDNACodec.validate(dnaV5);

    // 2. 線形 Pattern Weights (143次元) は 1:1 で複製
    const patternWeights = [...dnaV5.patternWeights];

    // 3. 相互作用行列 M (165 x 143) の再構築 (Row-Major)
    // 旧 163 行をそのままコピーし、新規 2 行 (index 163, 164) を 0.0 で初期化
    const OLD_C_DIM = 163;
    const NEW_C_DIM = 165;
    const P_DIM = 143;
    const contextPatternWeights = new Array<number>(NEW_C_DIM * P_DIM);

    // 行 0..162: 旧データをそのままコピー
    for (let c = 0; c < OLD_C_DIM; c++) {
      for (let p = 0; p < P_DIM; p++) {
        contextPatternWeights[c * P_DIM + p] = dnaV5.contextPatternWeights[c * P_DIM + p];
      }
    }

    // 行 163, 164: 中立 0.0 で初期化
    for (let c = OLD_C_DIM; c < NEW_C_DIM; c++) {
      for (let p = 0; p < P_DIM; p++) {
        contextPatternWeights[c * P_DIM + p] = 0.0;
      }
    }

    // 4. メタデータの複製と移行 Provenance の付与
    const metadata = {
      ...DecisionDNACodec.cloneMetadata(dnaV5.metadata),
      migratedFromSchema: 5,
      migratedAt: new Date().toISOString(),
      migrationWorkId: "BP-SIM-AI-V92-FEATURE-SCHEMA-V6-DESIGN-V1",
    };

    const dnaV6: DecisionDNA = {
      formatVersion: 1,
      schemaVersion: 6,
      genomeId: dnaV5.genomeId,
      patternWeights,
      contextPatternWeights,
      metadata,
    };

    DecisionDNACodec.validate(dnaV6);
    return dnaV6;
  }
}
```

### 5.4 スコア不変性の数学的証明 (Proof of Mathematical Score Invariance)

**定理**: 任意の合法的 `DecisionRequest` $R$ およびその任意の合法的候補パターン $p \in \text{patterns}$ に対し、移行前後の DNA によるスコア差は恒等的にゼロである。
$$\Delta \text{Score}(p) = \text{Score}_{v6}(p) - \text{Score}_{v5}(p) = 0.0$$

**証明**:
Feature Schema v5 における評価スコアの計算式は以下です：
$$\text{Score}_{v5}(p) = W_p + \sum_{i=0}^{162} c_i \cdot M_{i, p}^{v5}$$

Feature Schema v6 における評価スコアの計算式は以下です：
$$\text{Score}_{v6}(p) = W_p + \sum_{i=0}^{164} c_i \cdot M_{i, p}^{v6} = W_p + \sum_{i=0}^{162} c_i \cdot M_{i, p}^{v6} + c_{163} \cdot M_{163, p}^{v6} + c_{164} \cdot M_{164, p}^{v6}$$

移行契約により：
1. 線形重み $W_p$ は不変。
2. $i \in [0, 162]$ に対し、$M_{i, p}^{v6} = M_{i, p}^{v5}$。
3. $i \in \{163, 164\}$ に対し、$M_{i, p}^{v6} = 0.0$。

したがって：
$$\text{Score}_{v6}(p) = W_p + \sum_{i=0}^{162} c_i \cdot M_{i, p}^{v5} + c_{163} \cdot 0.0 + c_{164} \cdot 0.0 = \text{Score}_{v5}(p)$$
$$\Delta \text{Score}(p) = 0.0 \quad (\text{Q.E.D.})$$

**結論**: ゼロ初期化により、既存の学習済み DNA を v6 へ移行しても、事後突然変異や追加学習が行われるまでは、既存のすべての局面におけるスコアリングおよび選択（Argmax + タイブレーク）が **100% 完全同一** に維持されます。移行に伴う性能劣化や行動の狂いは一切発生しません。

---

## 6. Semantic Fingerprint 改定仕様 (Semantic Fingerprint Evolution Specification)

### 6.1 フィンガープリント改定マトリクス

フォーカス状態への感度を持たせるため、以下の通りフィンガープリントのバージョンを更新します：

| 指紋種別 | 現行バージョン | 新バージョン | 改定内容 | 理由 |
|---|:---:|:---:|---|---|
| **盤面構造 (Turn-Aware)** | `sgf1` | **`sgf1`** (維持) | 変更なし（すでに `state.focusPlayer` を保持） | 現行で感度充足 |
| **盤面構造 (Turn-Invariant)** | `sgf1-ti` | **`sgf1-ti`** (維持) | 変更なし（すでに `state.focusPlayer` を保持） | 現行で感度充足 |
| **プレイヤー観測** | `pof1` | **`pof2`** | `extractObservationProjection` に `focusPlayerId: obs.focusPlayerId` を追加 | フォーカス変更の観測検知 |
| **判断要求意味論** | `drsf1` | **`drsf2`** | 内包する Observation Projection を `pof2` 準拠へ更新 | 判断要求の完全一意識別 |
| **ポリシー入力数値** | `gpif1` | **`gpif2`** | 165次元 Context ベクトルを含む `GenomePolicyScoringInputProjection` をハッシュ化 | 入力特徴量更新への感度 |

### 6.2 `pof2` 射影仕様

`extractObservationProjection` において、`obs.focusPlayerId` を明示的に射影に含めます：

```typescript
return {
  viewerPlayerId: obs.viewerPlayerId,
  turnPlayerId: obs.turnPlayerId,
  chancePlayerId: obs.chancePlayerId,
  focusPlayerId: obs.focusPlayerId, // pof2 で追加
  turnCount: obs.turnCount ?? 1,
  players: ...
};
```

プレフィックスは `pof2-${hash}`、`drsf2-${hash}`、`gpif2-${hash}` となります。

### 6.3 受動的診断不変契約 (Passive Diagnostic Invariant)

- フィンガープリント計算は受動的オブザーバー（Passive Diagnostic）であり、ゲーム進行、乱数消費（PRNG）、StateHasher、勝敗判定に一切影響を与えません。
- 診断機能の有効/無効に関わらず、シミュレーション結果は 100% byte-identical に一致します。

---

## 7. 受入テストスイート仕様 (Required Acceptance Test Suite Specification)

次回実装タスクにおいて必須とされるテスト項目一覧を策定します：

### 7.1 特徴量エンコーダー受入テスト (`decisionFeatureEncoderV6.test.ts`)
1. **次元数整合性**:
   - `encodeContext` が正確に 165 次元の配列を返すこと。
   - `encodePatterns` の各要素が正確に 143 次元の配列を返すこと。
   - 全体で 308 特徴量であることを確認。
2. **フォーカス特徴量活性化検証**:
   - `obs.focusPlayerId === viewerId` の場合、`values[163] === 1`, `values[164] === 0` であること。
   - `obs.focusPlayerId !== viewerId`（相手）の場合、`values[163] === 0`, `values[164] === 1` であること。
   - `obs.focusPlayerId === undefined` の場合、`values[163] === 0`, `values[164] === 0` であること。
3. **鏡像対称性検証**:
   - Seat-Swap（p1視点 vs p2視点）において、フォーカス保持者に対する相対表現が鏡像対称に反転すること。

### 7.2 スケーラー受入テスト (`decisionFeatureScalingV6.test.ts`)
1. **Registry 整合性**:
   - TypeScript 定義と `docs/ai-v92-feature-schema-v6-registry-v1.json` の全308特徴量が 1:1 で完全一致すること。
2. **Identity スケーリング検証**:
   - 特徴量 163 および 164 の入力 `0` に対し出力 `0.0`、入力 `1` に対し出力 `1.0` を返すこと。
   - 不正な値（負値、2以上の値、NaN、Infinity）に対する Fail-Closed 例外送出を検証。

### 7.3 DNA 移行・不変性受入テスト (`decisionDNAMigrationV6.test.ts`)
1. **Migration 構造整合性**:
   - v5 DNA を移行した結果、`schemaVersion === 6`、`contextPatternWeights.length === 165 * 143 = 23,595` となること。
   - 行 0..162 の全重みが v5 と完全に一致すること。
   - 行 163, 164 の全 286 重みが厳密に `0.0` であること。
2. **スコア不変性 (Score Invariance) 実機検証**:
   - 実際の一連の `DecisionRequest`（Action, Pass, Effect Selection を含む実戦データ）に対し、v5 DNA と移行後 v6 DNA を用いてスコアを算出し、全パターンで `Math.abs(scoreV6 - scoreV5) === 0` であることを実証。
3. **Fail-Closed 拒絶検証**:
   - v5 DNA を移行せずに v6 ランタイムで直接評価した場合、`FeatureSchemaMismatchError` が送出されること。

### 7.4 セマンティック診断受入テスト (`semanticDiagnosticV6.test.ts`)
1. **バージョン識別子検証**:
   - 生成されるプレフィックスが `pof2-`, `drsf2-`, `gpif2-` であること。
2. **フォーカス感度検証**:
   - 他の盤面情報が完全に同一で、`focusPlayerId` のみが異なる2つの観測情報に対し、`pof2`, `drsf2`, `gpif2` のハッシュが確実に相異することを検証。

---

## 8. Controlled A/B 評価・エビデンス計画 (Controlled A/B Evaluation Plan)

実装完了後に実施する決定論的比較検証プロトコルを定めます：

### 8.1 比較条件

- **Control 群**: Feature Schema v5（現行 163x143, 23,452 weights）
- **Treatment 群**: Feature Schema v6（新 165x143, 23,738 weights, 移行DNA & ゼロ初期化）

### 8.2 検証チェックポイント

1. **Deterministic Re-execution Parity**:
   - 同一 Seed、同一レギュレーション（`light-entry16`）において、Control (v5) と Treatment (v6 Migrated Zero-Init) の試合を実行し、全決定手、ターン数、勝敗、最終盤面ハッシュが **100% 完全一致** することを実証。
2. **Mutation & Expressiveness Test**:
   - 特徴量 163, 164 の重みに意図的な摂動（Perturbation $\pm 1.0$）を加えた Adversarial DNA を作成し、フォーカス状態に応じた行動選択の分離（Separability）が発生することを実証。

---

## 9. 影響分析と実装作業分解 (Impact Analysis & Implementation Breakdown)

次回実装タスクにおいて改修対象となるファイルと変更規模を明確化します：

| 分類 | ファイルパス | 変更内容 | 想定規模 |
|---|---|---|:---:|
| **Domain** | `src/domain/ai/DecisionFeatureTypes.ts` | `FEATURE_SCHEMA_VERSION = 6` へ更新、`CONTEXT_FEATURE_NAMES` に2件追加、次元定数更新 | 小 |
| **Engine** | `src/engine/ai/DecisionFeatureEncoder.ts` | `encodeContext` にて `obs.focusPlayerId` から 2 特徴量を抽出・追加 | 小 |
| **Domain** | `src/domain/ai/DecisionFeatureScalingRegistry.ts` | 308 特徴量の TypeScript レジストリへの更新 | 中 |
| **Domain** | `src/domain/ai/DecisionDNATypes.ts` | 型定義・スキーマバージョン更新 | 小 |
| **Engine** | `src/engine/ai/DecisionDNACodec.ts` | 次元数検証定数更新、v5 DNA 拒絶チェック | 小 |
| **Engine (新規)** | `src/engine/ai/DecisionDNAMigration.ts` | `migrateV5toV6` 実装、ゼロ初期化、メタデータ付与 | 中 |
| **Domain** | `src/domain/ai/SemanticDiagnosticTypes.ts` | 指紋バージョン `pof2`, `drsf2`, `gpif2` 定義 | 小 |
| **Engine** | `src/engine/ai/SemanticFingerprintCalculator.ts` | `extractObservationProjection` への `focusPlayerId` 追加、gpif2 更新 | 小 |
| **Tests** | `src/tests/ai/*.test.ts` | 既存テストの Schema v6 追従、新規受入テスト群の追加 | 中 |

---

## 10. リスク管理と結論 (Risk Management & Conclusion)

### 10.1 リスク要因と対策

1. **次元不一致によるメモリ・パフォーマンスへの影響**:
   - 相互作用重みが 286 次元増加（23,309 $\to$ 23,595）しますが、浮動小数点配列サイズ増加は約 2.3KB に過ぎず、キャッシュ局所性およびメモリ消費への悪影響は無視できるレベルです。
2. **既存進化母集団の破棄リスク**:
   - 数学的スコア不変性を持つ移行関数 `migrateV5toV6` により、これまでに生成・選抜された DNA 資産を破棄することなくシームレスに v6 へ昇格可能です。

### 10.2 結論とステータス

Feature Schema v6 は、第9.2版コアフローのフォーカス方式に完全追従し、AI の観測欠落を解消する最小限かつ最も堅牢な設計です。

- **ステータス**: **READY FOR INDEPENDENT REVIEW**（独立レビュー準備完了）
- 本仕様書、Canonical Registry (`docs/ai-v92-feature-schema-v6-registry-v1.json`)、およびロードマップ更新をもって、設計作業を完了とします。
