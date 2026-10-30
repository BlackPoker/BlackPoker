# BlackPoker Simulator - AI Feature Schema v6 設計仕様書 V1-R1

**作業ID**: `BP-SIM-AI-V92-FEATURE-SCHEMA-V6-DESIGN-V1-R1`
**設計ステータス**: DESIGNED / READY FOR INDEPENDENT REVIEW
**先行作業**: `BP-SIM-AI-V92-FEATURE-SCHEMA-V6-DESIGN-V1` (Commit: `aebfab517e3e2ed00c35bc51ec581d0f9afe6798`)
**コアベースライン**: 第9.2版コアフロー (Commit: `92a7fc50674c20026118cf20460c6ee423451a71`)
**対象ブランチ**: `BlackPoker/issue551-core-flow`
**Canonical Registry**: `docs/ai-v92-feature-schema-v6-registry-v1.json`
**更新日時**: 2026-10-30 JST

---

## 1. Document Identity & Formal Baseline

### 1.1 目的 (Purpose)

本仕様書は、Feature Schema v6 Design V1 の独立レビューで発見された契約不整合（DNA型定義、移行決定論性、スコア計算式、レジストリ記述、フォーカス検証、フィンガープリント改定、受入テスト設計）を厳格に修正し、第9.2版コアフローにおける `focusPlayer` を AI の意思決定モデル（Decision Feature Schema）へ正式統合するための Canonical Design Artifact（改訂第1版: R1）です。

### 1.2 設計限定原則 (Design Only Boundary)

本改訂も **DESIGN ONLY** を維持します。
- **本番コード修正の禁止**: `src/engine/**`, `src/domain/**`, `src/data/**` への変更は一切行いません（本番 diff: 0）。
- **DNA 移行・学習・自己対戦・進化実行の禁止**: Feature Schema v6 の実装、DNA 移行処理の実行、新規学習・自己対戦ループは開始しません。
- **許可された成果物**:
  1. 設計仕様書: `tools/simulator/docs/ai-v92-feature-schema-v6-design-v1.md`（本文書）
  2. Canonical Registry: `tools/simulator/docs/ai-v92-feature-schema-v6-registry-v1.json`
  3. ロードマップ更新: `tools/simulator/docs/ai-self-play-roadmap.md`

### 1.3 前提ベースライン (Formal Baseline)

- **Start SHA**: `aebfab517e3e2ed00c35bc51ec581d0f9afe6798`
- **Core Flow**: 第9.2版コアフロー（フォーカス方式、全員パス時 chancePlayer="system" 移行、Commit: `92a7fc50674c20026118cf20460c6ee423451a71`）
- **AI Controlled Evidence**: `BP-SIM-AI-V92-BASELINE-EVIDENCE-V1-R2`（FORMAL ACCEPTED）

---

## 2. 独立レビュー指摘事項と R1 改訂内容 (Review Audit & R1 Corrections)

| 指摘項目 | V1 での問題点 | R1 での是正内容 |
|---|---|---|
| **DNA Migration 型定義** | `formatVersion`, `schemaVersion`, `genomeId` などの非実在フィールドや、存在しない `DecisionDNACodec.cloneMetadata` を参照していた | `DecisionDNATypes.ts` を正本とし、`dnaFormatVersion`, `featureSchemaVersion`, `scoringModel`, `contextDimension`, `patternDimension`, `patternWeights`, `contextPatternWeights`, `metadata?` を用いた型検査可能なコードへ修正 |
| **v5 Source Validation** | v6 Codec で旧 DNA を validate すると `featureSchemaVersion` 不一致で即座に拒絶されるため、移行前の検証が成立しなかった | 移行専用の独立した旧形式検証器（`DecisionDNALegacyValidator.validateV5`）を定義し、通常ロード経路での Fail-Closed 拒絶契約を維持 |
| **Migration の決定論性** | `migratedAt: new Date().toISOString()` を含んでおり、同一 DNA に対する移行結果の JSON ハッシュが非決定論的であった | `new Date()`, `Math.random()`, 実行時タイムスタンプを DNA 内部から完全排除。静的メタデータのみを付与し、完全同一のビット完全移行を保証 |
| **スコア計算式と記法** | $\text{Score}(p) = W_p + \sum c_i M_{i, p}$ と表記し、候補手参照 $p$ と特徴量インデックス $j$ を混同、Pattern 内積総和が欠落していた | `GenomeScorer.ts` 実装に準拠し、候補手の Pattern 特徴量 $p_{\text{pat}, j}$ との積和 $\sum_j (w_j p_{\text{pat}, j}) + \sum_i \sum_j (M_{i, j} c_i p_{\text{pat}, j})$ へ数式を厳密化 |
| **実数同値性と実演算の区別** | 数学的な実数同値性のみを主張し、浮動小数点演算やタイブレークの議論が曖昧であった | 数学的な同値性 ($\Delta \text{score} = 0$)、実 JavaScript (IEEE 754) での数値完全一致、および Argmax/タイブレーク決定論的一致を峻別して証明・受入基準化 |
| **Registry 互換性契約** | 既存 306 項目が `Requires FEATURE_SCHEMA_VERSION = 5` のままで、v6 での妥当性が未表現、生成手順が非決定論的であった | 全既存項目の互換性記述を `Valid for FEATURE_SCHEMA_VERSION >= 5 (including Schema v6)` へ更新、決定論的生成日時を確定 |
| **Focus 検証と Fail-Closed** | `obs.focusPlayerId !== viewerPlayerId` を無条件に相手フォーカスと判定し、不正 ID や未定義を誤認するリスクがあった | `focusPlayerId === opponentPlayerId` を明示検証し、未定義・不正 ID 時は両フラグを安全に `0` とする Fail-Closed 仕様へ是正 |
| **2特徴量の数学的正当化** | 「2特徴量でなければ独立学習できない」という数学的に不正確な過剰主張を行っていた | $c_{\text{opp}} = 1 - c_{\text{self}}$ の下での線形代数的等価性を明記した上で、鏡像対称性・中立状態の表現力・遺伝的変異対称性の3点から正当化を再定義 |
| **Fingerprint バージョニング** | `pof2`, `drsf2`, `gpif2` の改定仕様が断片的で、診断結果型や過去 Evidence との比較可否が曖昧であった | 型定義、プレフィックス、`SemanticDiagnosticResult` バージョン、受動的診断不変性、過去 Evidence との比較不可契約を網羅 |

---

## 3. 現状アーキテクチャとギャップ監査 (Current Architecture & Gap Audit)

### 3.1 Feature Schema v5 現状仕様
- **Context Feature 次元数**: 163 次元 (`CONTEXT_FEATURE_DIMENSION = 163`)
- **Pattern Feature 次元数**: 143 次元 (`PATTERN_FEATURE_DIMENSION = 143`)
- **総特徴量数**: $163 + 143 = 306$ 次元
- **相互作用重み次元数**: $163 \times 143 = 23,309$ 次元
- **DNA 総重み次元数**: $143 + 23,309 = 23,452$ 次元

### 3.2 第9.2版コアフローのフォーカス状態と不感性
1. **ランタイム契約**:
   - 第9.2版コアフローの正規ゲーム進行中、`state.focusPlayer` は常に `"p1"` または `"p2"` を保持します。
   - `chancePlayer` がルールシステム（`"system"`）へ遷移している最中（連続パス解決、ステージ解決中）であっても、`state.focusPlayer` は有効なプレイヤーを保持し続けます。
2. **Encoder の不感性**:
   - `DecisionFeatureEncoder.ts` は `obs.turnPlayerId` および `obs.chancePlayerId` のみを抽出し、`obs.focusPlayerId` を無視しています。
   - このため、AI は「自分にフォーカスがあるか」を数値化できず、手番・パス状況の文脈を完全には分離できません。
3. **Semantic Fingerprint の不整合**:
   - `sgf1` / `sgf1-ti` は `state.focusPlayer` を保持して感度を持ちますが、`pof1`, `drsf1`, `gpif1` は除外されているため不感となっています。

---

## 4. Feature Schema v6 フォーカス特徴量仕様 (Focus Feature Specification)

### 4.1 特徴量定義

Context 特徴量の末尾（Index 163, 164）に以下の 2 特徴量を追加します：

| Index | 特徴量名 (`name`) | 型 | 定義式 (`rawFormulaSummary`) | 値域 | スケーリング関数 | スケール後値域 |
|:---:|:---|:---:|:---|:---:|:---:|:---:|
| **163** | `self_is_focus_player` | `BOOLEAN_FLAG` | `observation.focusPlayerId === viewerPlayerId ? 1 : 0` | $\{0, 1\}$ | `identity` | $[0, 1]$ |
| **164** | `opponent_is_focus_player` | `BOOLEAN_FLAG` | `observation.focusPlayerId === opponentPlayerId ? 1 : 0` | $\{0, 1\}$ | `identity` | $[0, 1]$ |

ここで、`viewerPlayerId` はリクエスト対象のプレイヤー（`request.playerId`）、`opponentPlayerId` は合法な対戦相手プレイヤーキー（`"p1"` または `"p2"` のうち `viewerPlayerId` でない方）を指します。

### 4.2 フォーカス検証と Fail-Closed 仕様 (Focus Validation & Fail-Closed)

ランタイムおよび観測情報における各状態に対するエンコード挙動を以下のように厳格化します：

1. **正規対戦状態 (`focusPlayerId \in \{"p1", "p2"\}`)**:
   - 自身がフォーカス保持時: `(1, 0)`
   - 相手がフォーカス保持時: `(0, 1)`
2. **ルールシステムチャンス時 (`chancePlayer === "system"`)**:
   - `focusPlayerId` は直前のフォーカス保持者（または次フォーカス受給者）を保持しているため、通常通り `(1, 0)` または `(0, 1)` を返します。
3. **未定義・初期化前・サニタイズ境界 (`focusPlayerId === undefined`)**:
   - 試合開始前、あるいは観測情報の意図的サニタイズ時は、両フラグとも安全に `(0, 0)`（中立状態）と評価されます。
4. **不正なプレイヤーID (`focusPlayerId \notin \{"p1", "p2"\}`)**:
   - `"system"`, `"unknown"`, 空文字などの不正な値が渡された場合、`focusPlayerId === opponentPlayerId` は `false` となるため、**相手フォーカスとして誤認せず `(0, 0)` として安全にフェイルクローズ**します。
5. **旧テストフィクスチャ互換性**:
   - `focusPlayerId` が設定されていない旧テスト用モックデータ（Observation fixture）が入力された場合でも、クラッシュや例外を起こさず `(0, 0)` として決定論的に処理されます。

### 4.3 2特徴量採用の技術的根拠と過剰主張の是正 (Feature Count Justification)

#### 数学的関係の整理
正規ランタイムにおいて `focusPlayerId` が常に `p1` または `p2` に割り当てられる場合、観測者にとって $c_{\text{opp}} = 1 - c_{\text{self}}$（相互に完全な補数）となります。
このとき、任意のパターン特徴量 $p_j$ に対する相互作用スコアは：
$$M_{\text{self}, j} \cdot c_{\text{self}} \cdot p_j + M_{\text{opp}, j} \cdot c_{\text{opp}} \cdot p_j = M_{\text{self}, j} \cdot c_{\text{self}} \cdot p_j + M_{\text{opp}, j} \cdot (1 - c_{\text{self}}) \cdot p_j = M_{\text{opp}, j} \cdot p_j + (M_{\text{self}, j} - M_{\text{opp}, j}) \cdot c_{\text{self}} \cdot p_j$$
となります。
したがって、線形重み $w_j' = w_j + M_{\text{opp}, j}$、相互作用重み $M_j' = M_{\text{self}, j} - M_{\text{opp}, j}$ と再定義すれば、数学的には単一のブール特徴量 $c_{\text{self}}$ のみであらゆる線形＋バイリニア関数を完全に同値表現可能です。
「2特徴量でなければ独立学習できない」という主張は数学的に誤りであり、本改訂において撤回・訂正します。

#### 2特徴量を維持する 3 つの正当な技術的根拠
単一特徴量化せず、2特徴量（`self_is_focus_player`, `opponent_is_focus_player`）を維持する理由は以下の3点です：

1. **アーキテクチャの統一性と鏡像対称性 (Viewer-Relative Symmetry)**:
   - Feature Schema におけるプレイヤー状態表現は、すべて自分・相手のペアで設計されています：
     - `self_is_turn_player` (Index 2) / `opponent_is_turn_player` (Index 4)
     - `self_is_chance_player` (Index 3) / `opponent_is_chance_player` (Index 5)
   - フォーカスのみを単一フラグ化することはスキーマの一貫性を損ない、Seat-Swap 検証における鏡像対称性テストの抽象度を低下させます。
2. **3状態（中立・未割り当て）の非線形分離 (Tri-State Neutral Expressiveness)**:
   - 現実のシミュレーターでは、初期化前やサニタイズ時、レガシーフィクスチャなど、`focusPlayerId` が確定していない「中立状態」が存在します。
   - 単一特徴量 $c_{\text{self}} \in \{0, 1\}$ では、$0$ が「相手がフォーカスを持つ」のか「未確定中立」なのかを区別できません。
   - 2特徴量であれば、自分フォーカス `(1, 0)`、相手フォーカス `(0, 1)`、中立 `(0, 0)` の3状態を自然かつ安全に表現できます。
3. **遺伝的変異の対称性と探索空間の等方性 (Genetic Operator Symmetry)**:
   - Irwin-Hall 突然変異は各遺伝子座に対して独立に正規型摂動を加えます。
   - 2変数設計であれば、自手番での積極策バイアス ($M_{\text{self}, j}$) と被フォーカス時での迎撃・パス選好 ($M_{\text{opp}, j}$) が、線形パターンの基礎重み $w_j$ を歪めることなく独立して局所探索されます。

---

## 5. Canonical Feature Scaling 仕様 (Registry v6 Contract)

### 5.1 スケーリング規則

追加される 2 特徴量は、既存の Scaling Registry の `BOOLEAN` クラスに属します：
- **Scaling Class**: `BOOLEAN`
- **Scaling Function**: `identity` ($f(x) = x$)
- **Raw Domain**: $\{0, 1\}$
- **Scaled Output Domain**: $[0, 1]$
- **Parameter**: `{}`
- **Theoretical Bound**: $1.0$ (Known: true)
- **Zero Semantic**: 「条件不成立（フォーカスを保持していない、または未定義・不正）」

### 5.2 全308特徴量の Registry 整合性契約

`tools/simulator/docs/ai-v92-feature-schema-v6-registry-v1.json` の仕様：
- `schemaVersion`: 6
- `registryVersion`: `"1.0.0-r1"`
- `workId`: `"BP-SIM-AI-V92-FEATURE-SCHEMA-V6-DESIGN-V1-R1"`
- `generatedAt`: `"2026-10-30T00:00:00.000Z"`（決定論的静的日時）
- **既存 306 特徴量の `schemaCompatibilityImpact`**:
  `"Valid for FEATURE_SCHEMA_VERSION >= 5 (including Schema v6); raw integer scale normalized to bounded range to prevent mutation amplification."`
- **新規 2 特徴量 (Index 163, 164) の `schemaCompatibilityImpact`**:
  `"Introduced in FEATURE_SCHEMA_VERSION = 6 for v9.2 Core Flow focusPlayer integration; identity scaling preserves discrete {0, 1} semantics."`
- **旧項目の完全保持**:
  特徴量名、Index（Context 0..162, Pattern 0..142）、Scaling Class、Scaling Function、パラメータ、値域は v5 から一切変更しません。

---

## 6. Decision DNA 互換性と決定論的移行契約 (Decision DNA Migration Contract)

### 6.1 正本型定義に基づく実フィールド (Source of Truth Alignment)

`src/domain/ai/DecisionDNATypes.ts` に準拠し、Decision DNA のルート構造は以下のみを使用します：

```typescript
export interface DecisionDNA {
  readonly dnaFormatVersion: number;       // 必ず 1
  readonly featureSchemaVersion: number;  // Schema v6 では 6
  readonly scoringModel: string;           // "linear-bilinear-v1"
  readonly contextDimension: number;       // 165
  readonly patternDimension: number;       // 143
  readonly patternWeights: readonly number[];
  readonly contextPatternWeights: readonly number[];
  readonly metadata?: DecisionDNAMetadata;
}
```

> [!WARNING]
> `formatVersion`, `schemaVersion`, `genomeId` などの非実在フィールドを `DecisionDNA` のルート直下に記述してはなりません（`genomeId` や `generation` は `metadata` 内のプロパティです）。
> また、存在しない `DecisionDNACodec.cloneMetadata` は呼び出しません。

### 6.2 旧形式検証器 (Legacy v5 Source Validator)

Feature Schema v6 ランタイムにおける通常の `DecisionDNACodec.validate` は、`featureSchemaVersion !== 6` の DNA を即座に例外 `DecisionDNAValidationError` で拒絶します（暗黙の自動移行は禁止）。

移行処理を実行する際は、移行専用の `DecisionDNALegacyValidator.validateV5` を用いて事前に旧 v5 DNA を厳格に検証します：

```typescript
export class DecisionDNALegacyValidator {
  /**
   * Schema v5 Decision DNA を厳格に検証（v6 Codec から分離された旧形式検証器）
   */
  public static validateV5(dna: unknown): asserts dna is DecisionDNA {
    if (!dna || typeof dna !== "object") {
      throw new DecisionDNAValidationError("dna", "object", typeof dna, "null以外のオブジェクト必須");
    }
    const c = dna as Record<string, any>;

    if (c.dnaFormatVersion !== 1) {
      throw new DecisionDNAValidationError("dnaFormatVersion", 1, c.dnaFormatVersion);
    }
    if (c.featureSchemaVersion !== 5) {
      throw new DecisionDNAValidationError("featureSchemaVersion", 5, c.featureSchemaVersion);
    }
    if (c.scoringModel !== "linear-bilinear-v1") {
      throw new DecisionDNAValidationError("scoringModel", "linear-bilinear-v1", c.scoringModel);
    }
    if (c.contextDimension !== 163) {
      throw new DecisionDNAValidationError("contextDimension", 163, c.contextDimension);
    }
    if (c.patternDimension !== 143) {
      throw new DecisionDNAValidationError("patternDimension", 143, c.patternDimension);
    }
    if (!Array.isArray(c.patternWeights) || c.patternWeights.length !== 143) {
      throw new DecisionDNAValidationError("patternWeights.length", 143, c.patternWeights?.length);
    }
    if (!Array.isArray(c.contextPatternWeights) || c.contextPatternWeights.length !== 163 * 143) {
      throw new DecisionDNAValidationError("contextPatternWeights.length", 163 * 143, c.contextPatternWeights?.length);
    }

    // 全重みの有限数検証
    for (let i = 0; i < c.patternWeights.length; i++) {
      if (!Number.isFinite(c.patternWeights[i])) {
        throw new DecisionDNAValidationError(`patternWeights[${i}]`, "finite number", c.patternWeights[i]);
      }
    }
    for (let i = 0; i < c.contextPatternWeights.length; i++) {
      if (!Number.isFinite(c.contextPatternWeights[i])) {
        throw new DecisionDNAValidationError(`contextPatternWeights[${i}]`, "finite number", c.contextPatternWeights[i]);
      }
    }

    // メタデータの JSON-safe バリデーション
    if (c.metadata !== undefined) {
      DecisionDNACodec.validateMetadata(c.metadata);
    }
  }
}
```

### 6.3 完全決定論的 DNA 移行関数 (`DecisionDNAMigration.migrateV5toV6`)

本関数は完全に決定論的な純粋関数として実装します。`new Date()`、`Math.random()`、実行時環境依存の変数は一切使用しません。

```typescript
export class DecisionDNAMigration {
  public static readonly MIGRATION_RULE = "v5-to-v6-zero-init-v1";

  /**
   * Schema v5 Decision DNA を Schema v6 へ決定論的に移行
   */
  public static migrateV5toV6(dnaV5: Readonly<DecisionDNA>): DecisionDNA {
    // 1. 旧形式の厳格な検証
    DecisionDNALegacyValidator.validateV5(dnaV5);

    const OLD_C_DIM = 163;
    const NEW_C_DIM = 165;
    const P_DIM = 143;

    // 2. Pattern Weights (143次元) は厳密にコピー
    const patternWeights: number[] = new Array<number>(P_DIM);
    for (let j = 0; j < P_DIM; j++) {
      patternWeights[j] = dnaV5.patternWeights[j];
    }

    // 3. Row-major 相互作用行列 (165 x 143 = 23,595次元) の再構築
    const contextPatternWeights: number[] = new Array<number>(NEW_C_DIM * P_DIM);

    // 行 0..162: 旧 v5 の全 23,309 重みを厳密に Row-major コピー
    for (let c = 0; c < OLD_C_DIM; c++) {
      const rowOffset = c * P_DIM;
      for (let p = 0; p < P_DIM; p++) {
        contextPatternWeights[rowOffset + p] = dnaV5.contextPatternWeights[rowOffset + p];
      }
    }

    // 行 163, 164: 新規 2 行 (全 286 要素) を厳密に 0.0 で初期化
    for (let c = OLD_C_DIM; c < NEW_C_DIM; c++) {
      const rowOffset = c * P_DIM;
      for (let p = 0; p < P_DIM; p++) {
        contextPatternWeights[rowOffset + p] = 0.0;
      }
    }

    // 4. メタデータの決定論的複製と移行 Provenance
    // ※ new Date() などの非決定論的タイムスタンプは含めない
    let metadata: DecisionDNAMetadata | undefined = undefined;
    if (dnaV5.metadata !== undefined) {
      metadata = {
        ...JSON.parse(JSON.stringify(dnaV5.metadata)),
        migratedFromSchema: 5,
        migrationRule: this.MIGRATION_RULE,
      };
    } else {
      metadata = {
        migratedFromSchema: 5,
        migrationRule: this.MIGRATION_RULE,
      };
    }

    const dnaV6: DecisionDNA = {
      dnaFormatVersion: 1,
      featureSchemaVersion: 6,
      scoringModel: "linear-bilinear-v1",
      contextDimension: NEW_C_DIM,
      patternDimension: P_DIM,
      patternWeights,
      contextPatternWeights,
      metadata,
    };

    // 5. v6 Codec による新形式の完全性検証
    DecisionDNACodec.validate(dnaV6);

    return dnaV6;
  }
}
```

---

## 7. スコア計算式とスコア不変性 (Score Formula & Invariance)

### 7.1 GenomeScorer 準拠の厳密なスコア計算式

`GenomeScorer.ts` に準拠し、任意の合法パターン候補 $\text{pat}$（特徴量ベクトル $\mathbf{p}_{\text{pat}} \in \mathbb{R}^{P}$）のスコア計算式は以下です：

$$\text{Score}(\text{pat}) = \sum_{j=0}^{P-1} (w_j \cdot p_{\text{pat}, j}) + \sum_{i=0}^{C-1} \sum_{j=0}^{P-1} (M_{i, j} \cdot c_i \cdot p_{\text{pat}, j})$$

- $P$: Pattern 特徴量次元数 ($143$)
- $C$: Context 特徴量次元数 (v5 では $163$, v6 では $165$)
- $w_j$: Pattern 線形重み (`dna.patternWeights[j]`)
- $p_{\text{pat}, j}$: パターン候補 $\text{pat}$ の第 $j$ Pattern 特徴量 (`pat.values[j]`)
- $c_i$: 第 $i$ Context 特徴量 (`context.values[i]`)
- $M_{i, j}$: Context-Pattern 相互作用重み (`dna.contextPatternWeights[i * P + j]`)

### 7.2 スコア同値性の 3 階層検証 (Three-Tier Score Equivalence)

#### 1. 数学的実数同値性 (Mathematical Real Equivalence)
Feature Schema v6 において、新規追加された Context 特徴量 $c_{163}, c_{164}$ に対する相互作用重みは $M_{163, j}^{v6} = 0.0$, $M_{164, j}^{v6} = 0.0$ です。
したがって：
$$\text{Score}_{v6}(\text{pat}) = \sum_{j=0}^{142} w_j p_{\text{pat}, j} + \sum_{i=0}^{162} \sum_{j=0}^{142} M_{i, j}^{v5} c_i p_{\text{pat}, j} + \sum_{j=0}^{142} 0.0 \cdot c_{163} p_{\text{pat}, j} + \sum_{j=0}^{142} 0.0 \cdot c_{164} p_{\text{pat}, j} = \text{Score}_{v5}(\text{pat})$$
$$\Delta \text{Score}(\text{pat}) = 0.0$$

#### 2. 実 JavaScript 演算での数値完全一致 (IEEE 754 Floating-Point Exact Match)
`GenomeScorer.ts` の実装ループでは：
```typescript
for (let i = 0; i < cDim; i++) {
  const c_i = contextValues[i] ?? 0;
  if (c_i === 0) continue;
  const rowOffset = i * pDim;
  for (let j = 0; j < pDim; j++) {
    const p_j = pValues[j] ?? 0;
    if (p_j === 0) continue;
    const m_ij = cpWeights[rowOffset + j] ?? 0;
    score += m_ij * c_i * p_j;
  }
}
```
行 $i = 163, 164$ においては $m_{ij} = 0.0$ であるため、加算される値は `0.0 * c_i * p_j = 0` です。
加算順序は $i$ 昇順・$j$ 昇順で固定されており、浮動小数点丸め誤差の蓄積順序も完全に同一です。
したがって、JavaScript 実行時において：
$$\text{score}_{v6} === \text{score}_{v5} \quad (\text{bit-exact match})$$

#### 3. 選択一致 (Argmax / Tie-Break Parity)
各合法手候補のスコアが bit-exact に一致するため、最高スコア手（Argmax）および同点時の `patternRef` 最小手タイブレークの挙動は **100% 完全に一致** します。

---

## 8. Semantic Fingerprint 改定仕様 (Fingerprint Versioning)

### 8.1 バージョニングマトリクス

| 指紋種別 | 旧バージョン | 新バージョン | プレフィックス | 理由 |
|---|:---:|:---:|:---:|---|
| **構造的盤面 (Turn-Aware)** | `sgf1` | **`sgf1`** (維持) | `sgf1-` | 既存で `state.focusPlayer` を保持しており充足 |
| **構造的盤面 (Turn-Invariant)** | `sgf1-ti` | **`sgf1-ti`** (維持) | `sgf1-ti-` | 既存で `state.focusPlayer` を保持しており充足 |
| **プレイヤー観測** | `pof1` | **`pof2`** | `pof2-` | `focusPlayerId: obs.focusPlayerId` を射影に追加 |
| **判断要求意味論** | `drsf1` | **`drsf2`** | `drsf2-` | 内包する Observation を `pof2` 準拠へ更新 |
| **ポリシー入力数値** | `gpif1` | **`gpif2`** | `gpif2-` | 165次元 Context ベクトルを含む入力をハッシュ化 |

### 8.2 型定義と Result Version

- **`SemanticDiagnosticResult.semanticDiagnosticVersion`**: `2`
- **`GenomePolicyScoringInputProjection`**:
  ```typescript
  export interface GenomePolicyScoringInputProjection {
    readonly featureSchemaVersion: 6;
    readonly contextValues: readonly number[]; // Exactly 165 IEEE 754 floats
    readonly patterns: readonly {
      readonly patternRef: number;
      readonly values: readonly number[]; // Exactly 143 IEEE 754 floats
    }[];
  }
  ```

### 8.3 シグナル検出ロジックと Evidence 契約
1. **シグナル検出ロジックの完全互換性**:
   - `SemanticStallCycleDetector` は同一試合内のリングバッファ（$M=64$）でハッシュ文字列の等値比較を行います。プレフィックスが `pof2-` 等に更新されても、検出ロジック自体は変更不要で完全に動作します。
2. **履歴上限・受動的パリティの維持**:
   - $M \le \text{historySize}$ の有界メモリ契約、および Diagnostic OFF vs ON での論理結果 100% byte-identical パリティを完全維持します。
3. **Evidence 異種バージョン比較禁止契約**:
   - v1 Evidence（`pof1-...`）と v2 Evidence（`pof2-...`）は射影空間が異なるため、同一意味のハッシュとして比較・同一視することを禁止します。

---

## 9. 受入テスト設計仕様 (Required Acceptance Test Suite)

次回実装タスクにおいて必須とされる 20 項目を確定します：

1. **v5 Legacy Validation**: `DecisionDNALegacyValidator.validateV5` が正常な v5 DNA（163/143/23452次元）を PASS すること。
2. **v5 Direct Runtime Rejection**: v6 Codec で未移行 v5 DNA を直接 load/validate した場合、`featureSchemaVersion` 不一致で即座に例外送出すること。
3. **v5 -> v6 Deterministic Migration**: 同一 v5 DNA から 2 回移行した結果の JSON 文字列およびオブジェクトが 100% bit-exact に一致すること。
4. **DNA Metadata Preservation**: 既存の `id`, `name`, `generation` 等を保持し、静的プロヴナンス（`migratedFromSchema: 5`, `migrationRule`）のみを付与すること（動的タイムスタンプ不可）。
5. **Full Weight Exact Equality**: Pattern 重み（143要素）および相互作用重み（行 0..162 の全 23,309 要素）が v5 と完全に一致すること。
6. **Row-Major Mapping**: 行 $i$ の重みがオフセット $i \times 143$ に正しく配置されていること。
7. **Zero Initialized Rows**: 行 163 および 164 の全 286 重みが厳密に `0.0` であること。
8. **All-Pattern Scoring Parity**: 実戦 DecisionRequest の全候補手に対し、v5 DNA と移行後 v6 DNA のスコアが実 JavaScript 浮動小数点演算で完全一致（`===`）すること。
9. **Argmax / Tie-Break Parity**: `GenomePolicy.choose` による選択手（`patternRef`）が 100% 一致すること。
10. **Focus Self / Opponent / System Activation**:
    - `obs.focusPlayerId === viewerId` で `values[163] === 1`, `values[164] === 0`。
    - `obs.focusPlayerId === opponentId` で `values[163] === 0`, `values[164] === 1`。
    - `chancePlayer === "system"` 下でも上記が成立すること。
11. **Focus Missing / Invalid Fail-Closed**:
    - `focusPlayerId === undefined` で `(0, 0)`。
    - `focusPlayerId === "invalid"` や `"system"` で `(0, 0)`（相手フォーカスと誤認しない）。
12. **Seat Swap Symmetry**: p1 視点と p2 視点でフォーカス特徴量が鏡像反転すること。
13. **Registry 308 Entries**: Canonical Registry に 308 特徴量が漏れなく登録されていること。
14. **Registry Compatibility Fields**: 全既存 306 項目に `Valid for FEATURE_SCHEMA_VERSION >= 5 (including Schema v6)` が設定されていること。
15. **Identity Scaling**: 特徴量 163, 164 が `[0, 1]` の Identity スケーリングを行うこと。
16. **Old 306 Scaling Rules Unchanged**: 既存 306 特徴量のクラス・パラメータ・出力域が v5 から不変であること。
17. **pof2 / drsf2 / gpif2 Focus Sensitivity**: `turnPlayer` / `chancePlayer` が同一で `focusPlayer` のみが変化したとき、`pof2`, `drsf2`, `gpif2` が確実に変化すること。
18. **Diagnostic Output Versioning**: 診断結果のバージョンが `2`、プレフィックスが `pof2-`, `drsf2-`, `gpif2-` であること。
19. **Diagnostic OFF/ON Parity**: 診断有効時と無効時で対戦ログ・結果・ハッシュが 100% byte-identical に一致すること。
20. **Same-Seed Match Determinism**: 同一シードでの対戦再実行において、完全な決定論的一致を実証すること。

---

## 10. 影響分析と実装作業分解 (Impact Analysis)

| ファイルパス | 責務と変更内容 | 規模 |
|---|---|:---:|
| `src/domain/ai/DecisionFeatureTypes.ts` | `FEATURE_SCHEMA_VERSION = 6`, 特徴量名配列更新, 次元定数更新 | 小 |
| `src/engine/ai/DecisionFeatureEncoder.ts` | `encodeContext` にて `focusPlayerId` 検証と 2 特徴量抽出を追加 | 小 |
| `src/domain/ai/DecisionFeatureScalingRegistry.ts` | 308 特徴量の TypeScript 定義へ更新 | 中 |
| `src/domain/ai/DecisionDNATypes.ts` | `DecisionDNA` 型定義および定数更新 | 小 |
| `src/engine/ai/DecisionDNACodec.ts` | v6 次元数定数更新、v5 DNA 拒絶検証 | 小 |
| `src/engine/ai/DecisionDNALegacyValidator.ts` (新規) | `validateV5` 旧形式検証器の実装 | 小 |
| `src/engine/ai/DecisionDNAMigration.ts` (新規) | `migrateV5toV6` 決定論的移行関数の実装 | 中 |
| `src/domain/ai/SemanticDiagnosticTypes.ts` | `pof2`, `drsf2`, `gpif2`, `semanticDiagnosticVersion = 2` | 小 |
| `src/engine/ai/SemanticFingerprintCalculator.ts` | `extractObservationProjection` への `focusPlayerId` 射影追加 | 小 |
| `src/engine/ai/SemanticFingerprintFieldRegistry.ts` | R9 レジストリ追従 | 小 |
| `src/tests/ai/*.test.ts` | 受入テスト 20 項目の実装と既存テストの v6 追従 | 中 |

---

## 11. リスク管理と結論 (Risk Management & Conclusion)

- **メモリ影響**: 浮動小数点配列の増加は約 2.3KB であり、実行時性能への影響は皆無です。
- **後方互換性**: 決定論的移行とスコア不変性証明により、既存の g0/g1 進化母集団 DNA 資産をノーリスクで v6 へ昇格可能です。
- **結論**: 本 R1 設計により、独立レビューで指摘された型契約・決定論性・数式・検証ロジックの不整合はすべて完全に解消されました。

**Final Status**: **READY FOR INDEPENDENT REVIEW**
