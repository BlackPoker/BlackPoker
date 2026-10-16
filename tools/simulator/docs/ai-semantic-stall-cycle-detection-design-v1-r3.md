# BlackPoker Simulator
# Semantic Stall / Cycle Detection Diagnostic Architecture Design V1-R3

## 1. Document Identity
- **Work ID**: `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R3`
- **Document Version**: `1.3.0`
- **Status**: `DESIGNED / PENDING INDEPENDENT REVIEW`
- **Supersedes**: `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R2` (Commit: `14de5ffd567a099b27ec7c23389741d2859e2491`, NOT ACCEPTED / R3 REQUIRED)
- **Target Component**: BlackPoker Simulator (`tools/simulator/`)
- **Category**: AI Self-Play / Diagnostic Architecture Specification (DESIGN ONLY)
- **Author**: BlackPoker Simulator AI Diagnostics & Core Flow Architecture Team

---

## 2. Formal Baseline
本設計書 (V1-R3) は、以下の正式採択コミットおよび過去の証拠を不変の前提ベースラインとして策定されています：

1. **Feature Scaling Design V1-R2**:
   - Status: `FORMAL ACCEPTED`
   - Commit SHA: `4c9f8c273d9c2bd8068173dd1333bcc55547668a`
2. **Feature Scaling Implementation V1-R2**:
   - Status: `FORMAL ACCEPTED`
   - Commit SHA: `975788f80054f4e5a08e446ee9967d400726bca9`
3. **Controlled Feature Scaling A/B Evidence V1-R1**:
   - Status: `FORMAL ACCEPTED`
   - Commit SHA: `97d2ac1fa2db79f459c75e4f1fd19486125d1ef6`
4. **Semantic Stall / Cycle Detection Design V1**:
   - Status: `NOT ACCEPTED / SUPERSEDED BY R1`
   - Commit SHA: `6ab04120fb3cfc9dccf4cf04f9c824e091af374d`
5. **Semantic Stall / Cycle Detection Design V1-R1**:
   - Status: `NOT ACCEPTED / SUPERSEDED BY R2`
   - Commit SHA: `81433f8e5cdcec44bcffca51ce476f0d2e1b8fbe`
6. **Semantic Stall / Cycle Detection Design V1-R2**:
   - Status: `NOT ACCEPTED / SUPERSEDED BY R3`
   - Commit SHA: `14de5ffd567a099b27ec7c23389741d2859e2491`
7. **Start Commit HEAD**: `14de5ffd567a099b27ec7c23389741d2859e2491`
8. **Branch**: `BlackPoker/issue551-core-flow`
9. **Rules / Core Flow Status**: `RULES UNCHANGED / NO CHANGE PLANNED` (0 diff contract)

---

## 3. V1-R2 Review Findings & R3 Remediation
V1-R2 設計（SHA: `14de5ffd567a099b27ec7c23389741d2859e2491`）の Independent Review において指摘された主要なブロッカーおよび解消内容は以下の通りです：

1. **Blocker A: 存在しない `FeatureSchemaConstants.ts` 参照の完全除去と実在ソースの明定**:
   - **問題点**: R2 設計書および報告書において、Feature Schema 定数の Canonical Source として `src/domain/ai/FeatureSchemaConstants.ts` という存在しないファイルパスが記載されていた。
   - **Current Source の監査・確定**: 以下の実在するファイルが唯一の Source of Truth であることを確認し、全ドキュメント・レジストリで参照パスを完全一致させた：
     - `tools/simulator/src/domain/ai/DecisionFeatureTypes.ts`:
       - `FEATURE_SCHEMA_VERSION = 5`（数値型）
       - `CONTEXT_FEATURE_NAMES`（配列長 163）
       - `CONTEXT_FEATURE_DIMENSION = 163`
       - `PATTERN_FEATURE_NAMES`（配列長 143）
       - `PATTERN_FEATURE_DIMENSION = 143`
       - `EncodedDecisionFeatures`
     - `tools/simulator/src/domain/ai/DecisionDNATypes.ts`:
       - `DNA_FORMAT_VERSION = 1`
       - `DNA_CONTEXT_DIMENSION = 163`
       - `DNA_PATTERN_DIMENSION = 143`
       - `DNA_INTERACTION_DIMENSION = 23,309` (163 * 143)
       - `DNA_TOTAL_WEIGHTS = 23,452` (143 + 23,309)
       - `DecisionDNA` (`patternWeights`, `contextPatternWeights`, `metadata` 等)
   - **R3 是正**: 存在しない `FeatureSchemaConstants.ts` の参照を完全に除去した（残存数: 0）。
2. **Blocker B: Current Runtime Fields と Derived Research Candidates の厳格な分離**:
   - **問題点**: R2 レジストリにおいて、`rulePackage.contentDigest` および `simulator.buildSha` があたかも `RulePackage.ts` や `package.json` のランタイムプロパティであるかのように混同されていた。
   - **Current Source の事実**:
     - `RulePackage.ts` に `contentDigest` プロパティは存在しない。
     - `package.json` に `buildSha` プロパティは存在しない。
   - **R3 是正**: レジストリ内に `origin` 区分（`CURRENT_RUNTIME_FIELD` vs `DERIVED_RESEARCH_CANDIDATE`）および `runtimePropertyExists`（boolean）を明示的に導入：
     - `rulePackage.contentDigest`: `origin: "DERIVED_RESEARCH_CANDIDATE"`, `runtimePropertyExists: false`。RulePackage の正規化 JSON（actions, components）から導出する SHA-256 ダイジェストの候補値であることを明記。
     - `simulator.buildSha`: `origin: "DERIVED_RESEARCH_CANDIDATE"`, `runtimePropertyExists: false`。ビルド時環境変数（`BP_BUILD_SHA` / `VITE_BUILD_SHA`）または Git コミット SHA から導出する識別子の候補値であることを明記。
     - `Continuation Context` は引き続き **RESEARCH CANDIDATE** であり、**CONTINUATION EQUIVALENCE: NOT PROVEN** であることを維持。
3. **Registry Source Integrity Audit（全エントリのプロパティ実在性監査）**:
   - `CURRENT_RUNTIME_FIELD` として分類された全 130 エントリについて、`sourceFile` が実在し、該当プロパティが Current Source に実在することをプログラム的・コード監査により 100% 検証した。
   - プロデューサー／コンシューマーの記述精度向上のため、以下の参照ソースファイルを精確化：
     - `state.turnUsage`: `CommandRegistry.ts`（記録・管理）/ `StateHasher.ts`
     - `state.nextRequestSeq`: `CommandRegistry.ts`（発番）/ `StateHasher.ts`
     - `state.players[pKey].trumps`: `StateHasher.ts`（抽出）/ `ObservationFactory.ts`
     - `policy.dna.weights`: `DecisionDNA` の実在プロパティに合わせて `policy.dna.patternWeights`（143次元）および `policy.dna.contextPatternWeights`（23,309次元）へ精緻化し、`DecisionDNATypes.ts` を Canonical Source として確定。
   - 監査結果: `CURRENT_RUNTIME_FIELD: 130`, `DERIVED_RESEARCH_CANDIDATE: 2`（総エントリ数: 132）。`REVIEW_REQUIRED = 0`, `UNKNOWN = 0`。

---

## 4. Problem Statement
Formal Accepted となった `BP-SIM-AI-FEATURE-SCALING-AB-EVIDENCE-V1-R1` において、Feature Scaling は特徴量および相互作用重みを有界化し、PASS スコアマージンを大幅に圧縮（+1.565003 $\rightarrow$ +0.052248）したものの、Controlled N=6 g1 集団における全体完了率は以下の通り不変でした：

- **CONTROL (RAW_V4_EQUIVALENT)**: 2 / 30 Completed (28 Incomplete at `maxDecisions = 500`)
- **TREATMENT (SCALED_V5)**: 2 / 30 Completed (28 Incomplete at `maxDecisions = 500`)

この残存 28 Incomplete 対戦について、以下の疑問が存在します：
1. **Semantic Stall**: 盤面・効果・手札が何一つ進展しないまま、空の PASS 等が連続しているのか？
2. **Periodic Cycle**: プレイヤー双方が同一または周期的な盤面・判断文脈を行き来するループに陥っているのか？
3. **Genuine Progress**: 状態は健全に進展しているものの、500 回の決定上限が単に短いだけなのか？
4. **Bookkeeping Artifact**: 内部シーケンス番号（`sequence`, `stateVersion`）のみが進んで「異なる状態」と見誤っていないか？

本設計は、既存エンジン・ルール・ポリシーに一切の副作用を与えることなく、これらを数学的決定性をもって受動的に観測・診断するための仕様を確定します。

---

## 5. Explicit Non-Claims
本設計および将来の診断実装において、以下を **明示的に主張しない (Explicit Non-Claims)** ことを厳格に規定します：

1. **Cycle Proven: NO** — フィンガープリントの一致・再訪のみをもって「無限ループ」「決定論的サイクル」「デッドロック」が証明されたとは主張しない。
2. **Infinite Loop Proven: NO** — 将来の外部入力、未観測の PRNG 分岐、ポリシータイブレークの揺らぎによりループを脱出する可能性を排除しない。
3. **Continuation Equivalence Proven: NO** — 観測可能な全フィンガープリントが一致しても、将来の同一軌跡が数学的に保証されたとは主張しない。
4. **Rules Bug Proven: NO** — インコンプリート対戦の発生をもってルール実装のバグと即断しない。
5. **Policy Cause Proven: NO** — 診断シグナルのみをもって特定のゲノム遺伝子座の欠陥と即断しない。
6. **Mutation Cause Proven: NO** — 遺伝的突然変異や交叉が停滞を引き起こした直接要因であると即断しない。
7. **Performance Improvement Proven: NO** — 診断機能の導入がシミュレーション速度やメモリ効率を向上させるとは主張しない。
8. **Multi-Generation Proven: NO** — N=6 g1 の結果をもって、多世代進化学習全体の収束性を証明したとは主張しない。

---

## 6. Existing StateHasher Exact Guarantee
既存の `StateHasher.ts` (State Hash v2) の厳密な保証範囲および非保証境界を以下のように固定します：

### 6.1 等価性が意味すること (What Equality Means)
- `StateHasher.hash(state)` の一致は、**「StateHasher v2 によって抽出された正規論理 GameState 射影 (Canonical Logical GameState Projection) をシリアライズした文字列の FNV-1a 64-bit ハッシュ値が一致すること」** のみを意味する。
- 抽出対象には、`presetId`, `turnCount`, `turnPlayer`, `chancePlayer`, `turnUsage`, `stateVersion`, `nextRequestSeq`, 正規化されたプレイヤーゾーン（手札、ライフ、フィールド、墓地、フォグ、切札）、ステージリクエスト、バッファリクエスト、墓地トップ選択が含まれる。

### 6.2 等価性が意味しないこと (What It Does NOT Mean)
1. **`same StateHash != same complete GameSession memory`**: `GameSession` のサイドステート（`passTracker.consecutivePassCount`, `resolvingRequest`, `resolvingContext`, `continuation`, `matchSeed` 等）は含まれていない。
2. **`same StateHash != Continuation Equivalence`**: 将来のゲーム進行が同一であることを保証しない。
3. **`same StateHash != cryptographic proof of identical state`**: FNV-1a 64-bit はコンパクトな非暗号学的ハッシュであり、衝突耐性の暗号学的証明ではない。
4. **`different StateHash != semantic gameplay progress`**: プレイヤーが何ら盤面を動かさず連続 PASS した場合でも、`stateVersion` や `nextRequestSeq` がインクリメントされるため StateHash は変化する。したがって、ハッシュ値の変化はゲームの意味論的進展を証明しない。

### 6.3 StateHasher の役割固定
既存の `StateHasher.ts` は Replay/Consistency の健全性検査シグナルとして一切変更せず（0 diff）、新しい診断機能の土台や置換対象として使用しない。

---

## 7. SimulationRunner Audit & Diagnostic Integration Boundary
`SimulationRunner.ts` における対戦実行ループを監査しました：
- `runMatch` は `GameSession` をインスタンス化し、`GameSessionStep`（PROGRESSED, WAITING_FOR_DECISION, FINISHED）をループ処理する。
- 各意思決定ステップにおいて `session.pendingDecision` が生成され、登録された `DecisionPolicy`（AI または Random）へ渡される。
- 決定結果 `DecisionResponse` は `session.applyDecision(response)` を通じてエンジンへ反映される。
- `maxDecisions`（デフォルト 500）到達時は `FINISHED` ではなく `INCOMPLETE` としてセッションを終了する。
- **診断統合境界**: 診断 Observer は `session.pendingDecision` の生成直後、および `session.applyDecision` の直前/直後に受動的に介入する設計とし、ループ制御や結果オブジェクトには一切干渉しない。

---

## 8. GameSession Side-State Audit
`GameSession.ts` の徹底監査により、GameState 外に保持されている以下の意味論的サイドステートを特定しました：

1. `session.passTracker.consecutivePassCount`:
   - 連続パス回数カウンタ。2 回連続パスでステージ解決またはターン終了というルール遷移の重要決定要因。GameState には存在しないため、Structural Fingerprint に必須。
2. `session.resolvingRequest`:
   - 現在解決中のリクエストのコピー。効果解決時判断の親リクエスト情報。
3. `session.resolvingContext`:
   - 効果解決コンテキスト（playerKey, keyCards, targetComponent, targetRequest, selections）。
4. `session.continuation`:
   - 複数ステップ効果（EffectContinuation）の中間状態・残余ステップ。
5. `session.pendingDecision`:
   - 現在回答待ちの DecisionRequest 参照。Current DecisionRequest と同一実体。
6. `session.matchSeed`:
   - 対戦の基底乱数シード。
7. `session.matchStartedRecorded` / `session.lastRecordedTurnPlayer`:
   - ログ記録器の内部フラグ・キャッシュ。Bookkeeping として除外。

---

## 9. Replay Hash Boundary
- **既存 Replay Hash**: `StateHasher.ts` による FNV-1a 64-bit（プレフィックス `sh2-<16 hex>`）。
- **目的**: 決定論的シミュレーションの整合性検査、ログ記録、リプレイ時の回帰検証。
- **制約**: 単調増加カウンタ（`stateVersion`, `nextRequestSeq`）を含んでいるため、状態再訪の検知には使用できない。

---

## 10. Structural Gameplay Fingerprint Specification
- **プレフィックス**: `sgf1-<64 hex>`
- **目的**: 内部管理カウンタ（`stateVersion`, `nextRequestSeq`, `decisionId`）を除外した、ルール上の意味的ゲーム盤面・状況の再訪候補検知。
- **対象ソース**: `GameState` + `GameSession` 意味的サイドステート（`consecutivePassCount`, `continuation`, `resolvingRequest`, `resolvingContext`）。
- **バリアント**:
  - **Variant S1 (Turn-Aware)**: `turnCount` を含み、同一ターン内またはターン進行を伴う厳密なゲーム状態を比較。
  - **Variant S2 (Turn-Invariant)**: `turnCount` を除外し、複数ターンにまたがる空ループ（マルチターン・パスループ）を検出。
- **非保証境界**: `same Structural Fingerprint != same future`。

---

## 11. Player Observation Fingerprint Specification
- **プレフィックス**: `pof1-<64 hex>`
- **目的**: 特定の Viewer（`request.playerId`）から合法的に観測可能な情報の等価性判定。
- **対象ソース**: `Readonly<PlayerObservation>`。
- **秘匿性保護**: 相手の伏せ手札、伏せ防壁、10枚以上の正確なライフ枚数、未開封パック中身等の秘密情報は完全に排除されている。
- **非保証境界**: `same Observation Fingerprint != same Full State`（相手の隠蔽情報が異なる可能性がある）。

---

## 12. Decision Request Root Type Audit
`DecisionRequest.ts` の全 9 個のルートフィールドを監査しました：

| フィールド名 | 型 | 分類 | 根拠 |
|:---|:---|:---:|:---|
| `protocolVersion` | `string` | `INCLUDE` | 通信・インターフェース互換性を識別する重要メタデータ。 |
| `matchId` | `string` | `EXCLUDE_BOOKKEEPING` | マッチインスタンスID。マッチ間比較を阻害するため除外。 |
| `decisionId` | `string` | `EXCLUDE_BOOKKEEPING` | 判断要求発番UUID/連番。決定文脈そのものには無関係。 |
| `stateVersion` | `number` | `EXCLUDE_BOOKKEEPING` | 盤面バージョンカウンタ。楽観的ロック用であり除外。 |
| `playerId` | `PlayerKey` | `INCLUDE` | 判断を行うプレイヤー（Viewer基準）。特徴量の全相関基準。 |
| `source` | `DecisionSource` | `INCLUDE` | 判断の起因理由（ACTION_REQUEST, EFFECT_RESOLUTION等）。 |
| `observation` | `PlayerObservation` | `INCLUDE` | 合法的観測モデル。 |
| `catalog` | `DecisionCatalog` | `INCLUDE` | パターン群から共有参照される実体カタログ。 |
| `patterns` | `readonly LegalPattern[]` | `INCLUDE` | 現在選べる合法パターン配列。順序保持必須。 |

---

## 13. LegalPattern Type Audit
`LegalPattern.ts` の全フィールドおよび 7 つのインデックス参照を監査しました：

1. `patternId: string` — **`EXCLUDE_BOOKKEEPING`**: デバッグ・リプレイ用文字列であり、`DecisionFeatureEncoder` および `GenomeScorer` には一切入力されない。
2. `kind: LegalPatternKind` — **`INCLUDE`**: パターン種別（ACTION, PASS, EFFECT_SELECTION）。Pattern Feature (0..3) に直結。
3. `actionSelectionRef?: ActionSelectionRef` — **`INCLUDE`**: `catalog.actions` への参照。
4. `keyCardSelectionRef?: CardSelectionRef` — **`INCLUDE`**: `catalog.cardSelections` への参照。
5. `keyUnitSelectionRef?: UnitSelectionRef` — **`INCLUDE`**: `catalog.unitSelections` への参照。
6. `costPaymentRef?: CostPaymentRef` — **`INCLUDE`**: `catalog.costPayments` への参照。
7. `targetSelectionRef?: TargetSelectionRef` — **`INCLUDE`**: `catalog.targetSelections` への参照。
8. `effectSelectionRef?: EffectSelectionRef` — **`INCLUDE`**: `catalog.effectSelections` への参照。
9. `orderSelectionRef?: OrderSelectionRef` — **`INCLUDE`**: `catalog.orderSelections` への参照。

**重要原則**: Ref 番号単体での等価性判定を厳格に禁止し、必ず参照先の実体データと紐づけて評価する。

---

## 14. DecisionCatalog Type Audit
`DecisionCatalog.ts` の全コレクションおよびプロパティを監査しました：

1. `actions: readonly ActionSelection[]`:
   - `actionId` (`INCLUDE`), `speed` (`INCLUDE`), `timing` (`INCLUDE`), `cost` (`INCLUDE`), `actionName` (`EXCLUDE_BOOKKEEPING`, 表示用)。
2. `cardSelections: readonly CardSelection[]`:
   - `cardIds` (`INCLUDE`), `displayCodes` (`EXCLUDE_BOOKKEEPING`, 表示用)。
3. `unitSelections: readonly UnitSelection[]`:
   - `unitIds` (`INCLUDE`), `displayNames` (`EXCLUDE_BOOKKEEPING`, 表示用)。
4. `costPayments: readonly CostPayment[]`:
   - `discardedCardIds` (`INCLUDE`), `drivenBulwarkUnitIds` (`INCLUDE`), `sacrificedUnitIds` (`INCLUDE`), `lifeCount` (`INCLUDE`), `summary` (`EXCLUDE_BOOKKEEPING`, 表示用)。
5. `targetSelections: readonly TargetSelection[]`:
   - `targetType` (`INCLUDE`), `targetPlayerKey` (`INCLUDE`), `targetUnitId` (`INCLUDE`), `targetRequestId` (`INCLUDE`), `targetDefinitionId` (`INCLUDE`), `displayName` (`EXCLUDE_BOOKKEEPING`, 表示用), `primaryLabel` (`EXCLUDE_BOOKKEEPING`, 表示用), `secondaryLabel` (`EXCLUDE_BOOKKEEPING`, 表示用)。
6. `effectSelections: readonly EffectSelection[]`:
   - `selectionType` (`INCLUDE`), `selectedValues` (`INCLUDE`), `assignments` (`INCLUDE`), `targetSelection` (`INCLUDE`), `candidateCount` (`INCLUDE`), `cards` (`INCLUDE`), `summary` (`EXCLUDE_BOOKKEEPING`, 表示用)。
7. `orderSelections: readonly OrderSelection[]`:
   - `orderedIds` (`INCLUDE`), `summary` (`EXCLUDE_BOOKKEEPING`, 表示用)。

**未使用エントリの扱い**: パターン群から参照されていないカタログエントリの差異は、ポリシー入力に影響しないため除外可能とする。

---

## 15. Decision Request Semantic Fingerprint Specification
- **プレフィックス**: `drsf1-<64 hex>`
- **目的**: 現在提示された判断要求（`DecisionRequest`）が表す合法な状況の意味論的等価性判定。
- **構成要素**:
  - `protocolVersion`
  - `playerId`
  - `source`
  - `observation`（サニタイズされた観測情報）
  - 順序を保持した `patterns` 配列
  - 各 `pattern` から参照される `catalog` の解決済み意味的コンテンツ（`actionId`, `speed`, `timing`, `cardIds`, `unitIds`, `costPayment`, `targetSelection`, `effectSelection`, `orderSelection`）
- **除外要素**: `matchId`, `decisionId`, `stateVersion`, `patternId`, 各種表示用文字列（`actionName`, `displayName`, `primaryLabel`, `secondaryLabel`, `summary` 等）。

---

## 16. Genome Policy Input Fingerprint Specification
- **プレフィックス**: `gpif1-<64 hex>`
- **目的**: 現在の `GenomePolicy` に入力され、`GenomeScorer` が受け取る数値特徴量入力が完全に一致することの判定。
- **入力ソース**: `DecisionFeatureEncoder.encode(request)` の出力を正規化した `GenomePolicyScoringInputProjection`。
- **厳格な非丸め原則 (No Lossy Rounding)**:
  - 小数点以下固定桁丸め（`toFixed(6)` 等）や epsilon 量子化を厳格に禁止。
  - IEEE 754 浮動小数点を完全な精度でシリアライズする（`-0` は `0` に正規化）。
  - `NaN` または `Infinity` が検出された場合は fail-closed（例外スロー）とする。
- **パターン順序の保持**:
  - `GenomePolicy` は同点時に最小の `patternRef`（配列の先頭）を選択する厳格 argmax であるため、パターンの並び順は変更せずそのままハッシュ化する（ソート禁止）。
- **等価性が意味する最大範囲**:
  "Current GenomePolicy receives an identical encoded scoring input under Feature Schema v5."

---

## 17. GenomePolicyScoringInputProjection Specification
`gpif1` のハッシュ化対象となる正規論理プロジェクションの仕様：

### 17.1 TypeScript Interface
```typescript
export interface GenomePolicyScoringInputProjection {
  readonly featureSchemaVersion: 5;
  readonly contextValues: readonly number[]; // Exactly 163 IEEE 754 floats (from CONTEXT_FEATURE_DIMENSION)
  readonly patterns: readonly {
    readonly patternRef: number;
    readonly values: readonly number[]; // Exactly 143 IEEE 754 floats (from PATTERN_FEATURE_DIMENSION)
  }[];
}
```

### 17.2 JSON Schema
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "GenomePolicyScoringInputProjection",
  "type": "object",
  "required": ["featureSchemaVersion", "contextValues", "patterns"],
  "additionalProperties": false,
  "properties": {
    "featureSchemaVersion": {
      "type": "integer",
      "const": 5
    },
    "contextValues": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 163,
      "maxItems": 163
    },
    "patterns": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["patternRef", "values"],
        "additionalProperties": false,
        "properties": {
          "patternRef": { "type": "integer", "minimum": 0 },
          "values": {
            "type": "array",
            "items": { "type": "number" },
            "minItems": 143,
            "maxItems": 143
          }
        }
      }
    }
  }
}
```

### 17.3 Canonical Source File と Runtime `EncodedDecisionFeatures` との差異
- **Canonical Source Files**:
  - `tools/simulator/src/domain/ai/DecisionFeatureTypes.ts`:
    - `FEATURE_SCHEMA_VERSION = 5`
    - `CONTEXT_FEATURE_DIMENSION = 163`
    - `PATTERN_FEATURE_DIMENSION = 143`
  - `tools/simulator/src/domain/ai/DecisionDNATypes.ts`:
    - `DNA_FORMAT_VERSION = 1`
    - `DNA_INTERACTION_DIMENSION = 23,309`
    - `DNA_TOTAL_WEIGHTS = 23,452`
- **ランタイム DTO との関係**:
  - ランタイムの `EncodedDecisionFeatures` は `context.values` に 163 次元を保持し、各 pattern は `kind`, `logicalPatternKey`, `values` (143次元) を保持する。
  - `GenomePolicyScoringInputProjection` は、`GenomeScorer` の計算結果に直結する `patternRef` と `values`、および `contextValues` のみを抽出し、表示用・デバッグ用の `logicalPatternKey` 等を排除した最小完全射影である。

---

## 18. Policy Identity Boundary
- **ポリシー入力とポリシー本体の分離**:
  - `Genome Policy Input Fingerprint` にはポリシーの DNA 重みや DNA ID を含めない。
  - これにより、「異なるポリシーが全く同じ状況に直面しているか」を比較可能とする。
- **GenomePolicy の内部状態**:
  - コード監査の結果、`GenomePolicy` はイミュータブルな DNA クローンを保持し、RNG や内部履歴を持たず、純粋関数的に動作することを確認（`Policy internal mutable history: none observed`）。
  - ただし「数学的に完全ステートレス」等の過剰主張は行わない。

---

## 19. Continuation Context Research Boundary
- **ステータス**: **RESEARCH CANDIDATE**
- **公式見解**: **CONTINUATION EQUIVALENCE: NOT PROVEN**
- **目的**: 「同じ状態から同一の未来が生じるか」を議論するための理論的境界モデル。
- **必要とされる最小候補要素**:
  1. ルール上の完全な内部シミュレータ状態（`GameState` + `GameSession` 意味論的サイドステート）
  2. 現在の決定文脈（`DecisionRequest`）
  3. ポリシー実装の識別子・バージョン
  4. ポリシー DNA の完全な重みダイジェスト（`patternWeights` + `contextPatternWeights`）
  5. ルールパッケージの完全な内容ダイジェスト（`rulePackage.contentDigest` [DERIVED_RESEARCH_CANDIDATE]）
  6. シミュレータエンジンのビルド識別子（`simulator.buildSha` [DERIVED_RESEARCH_CANDIDATE]）
  7. 特徴量スキーマバージョン（`Feature Schema v5`）
  8. PRNG / シャッフル継続状態（`matchSeed`, `runtimeShuffleCount`, 内部 PRNG 状態）
- **非主張**: 上記リストが必要十分であるとは現段階で主張しない。

---

## 20. RulePackage / Build Identity Boundary (Runtime vs Derived)
- **Current Runtime Properties**:
  - `rulePackage.id`: `RulePackage.ts` の実在プロパティ（例: `"rules-vnext"`）。
  - `rulePackage.version`: `RulePackage.ts` の実在プロパティ（例: `"9.1.2"`）。
- **Derived Research Candidates (Current Source に実在しない派生候補値)**:
  - `rulePackage.contentDigest`:
    - `RulePackage.ts` には実在しない。
    - 将来の診断実装において、RulePackage の正規化 JSON（actions, components）から SHA-256 で導出する digest の候補値。
  - `simulator.buildSha`:
    - `package.json` には実在しない。
    - 将来の診断実装において、ビルド時環境変数（`BP_BUILD_SHA` / `VITE_BUILD_SHA`）または Git コミット SHA から導出する識別子の候補値。

---

## 21. RNG / Shuffle Accessibility Boundary
コード監査に基づく乱数アクセシビリティの厳格な事実：

1. **`SeededRandom` のカプセル化**:
   - `tools/simulator/src/engine/random/RandomSource.ts` において、`SeededRandom` の内部状態 `state` は `private` である。
   - 公開 `RandomSource` インターフェースからはシード値のみが取得可能であり、内部状態は取得できない。
   - **設計原則**: 本診断設計のためにプロダクションコードのカプセル化を破壊して `state` を公開することは禁止する。
   - **レジストリ上のステータス**: `random.seededRandom.state` は `CURRENT_RUNTIME_FIELD`（実在プロパティ）であるが、`SOURCE_AUDITED_NOT_RUNTIME_ACCESSIBLE` と定義する。
2. **ランタイムシャッフルの決定論性**:
   - `DeterministicShuffle.ts` において、ゲーム中シャッフルは `deriveRuntimeShuffleSeed(matchSeed, state.runtimeShuffleCount)` によって直接派生される。
   - したがって、ランタイムシャッフルに関しては `matchSeed` と `state.runtimeShuffleCount` があれば完全に再現可能である。

---

## 22. Field Registry Contract
作成された `ai-semantic-fingerprint-field-registry-v1-r3.json` の仕様契約：

- **監査対象総エントリ数**: 132
- **Origin 内訳**:
  - `CURRENT_RUNTIME_FIELD`: 130（全エントリで sourceFile 実在 & プロパティ実在を検証済み）
  - `DERIVED_RESEARCH_CANDIDATE`: 2（`rulePackage.contentDigest`, `simulator.buildSha`）
- **ソースカバレッジ分類**:
  - `GameState`: Audited (49 Runtime Fields)
  - `GameSessionSideState`: Audited (8 Runtime Fields)
  - `DecisionRequestRoot`: Audited (9 Runtime Fields)
  - `LegalPattern`: Audited (9 Runtime Fields)
  - `DecisionCatalog`: Audited (38 Runtime Fields)
  - `PlayerObservation`: Audited (9 Runtime Fields)
  - `PolicyState`: Audited (5 Runtime Fields: `patternWeights`, `contextPatternWeights`, `metadata.id`, `featureSchemaVersion`, `dnaFormatVersion`)
  - `RNGShuffleContext`: Audited (1 Encapsulated Runtime Field: `state`)
  - `RulePackageBuildIdentity`: Audited (2 Runtime Fields + 2 Derived Research Candidates)
- **分類集計**:
  - `INCLUDE`: 100
  - `EXCLUDE_BOOKKEEPING`: 20
  - `INCLUDE_CONDITIONAL`: 12
  - `REVIEW_REQUIRED`: 0
  - `UNKNOWN`: 0
- **ポリシー関連未分類フィールド数**: 0

---

## 23. Identity Canonicalization
- **動的ランタイム ID の課題**:
  - シミュレータ実行中、`unit-cost-1788...` や `req-trg-1788...` などの動的 ID が採番される。
  - 生の ID を直接比較すると、同じ状況であっても採番カウンタの進み方によりハッシュが不一致となる。
- **Canonicalization 戦略**:
  - `StateHasher.ts` の実績ある 2-Pass Traversal を継承：
    1. 決定論的走査順序で全エンティティの動的 ID を検出し、出現順の canonical ID（例: `unit#1`, `req#1`）へマッピング。
    2. 全オブジェクトおよび参照フィールドを探索し、参照関係を保ったまま canonical ID へ置換。
- **ID 縮約の禁止 (No ID Collapse)**:
  - 異なるカード、異なるユニット、異なるリクエストを同一の ID へ潰してはならない。グラフ構造のトポロジーを厳格に保存する。

---

## 24. Ordering Semantics
コード監査に基づく全コンテナの順序意味論：

| コンテナ / ゾーン | 順序意味論 | 根拠 |
|:---|:---:|:---|
| **Stage Requests** | `Order-Preserving` (LIFO) | ステージはスタックであり、配列順序がそのまま解決順序（後入れ先出し）を規定する。再ソート厳禁。 |
| **Request Buffer** | `Order-Preserving` (FIFO) | 誘発キュー。配列順序がトリガー解決順序に影響する。 |
| **Life Cards** | `Order-Preserving` (TOP) | ライフ先頭（インデックス 0）への unshift や先頭からのダメージ消費。 |
| **Hand Cards** | `Order-Preserving` | `LegalPatternGenerator` が手札順でキーカード組合せを生成し、タイブレークに直結する。ソート禁止。 |
| **Field Units** | `Order-Preserving` | 戦闘解決や走査順序に影響。 |
| **Grave Cards/Units** | `Order-Preserving` (TOP) | 墓地先頭（`graveTopCardId`）および配置順。 |
| **Trumps / Fog** | `Order-Preserving` | 配置順および参照整合性。 |
| **Legal Patterns** | `Order-Preserving` | `GenomePolicy` の strict argmax タイブレーク（同点時先頭選択）に直結。ソート厳禁。 |

---

## 25. Hidden Information & Visibility Boundaries
- **合法的観測と完全状態の分離**:
  - `PlayerObservation` は、Viewer プレイヤーがルール上知り得る情報のみで構成される。
  - 相手の手札中身、相手の伏せ防壁カード中身、相手の10枚以上のライフ正確値、未開封パック中身などは安全に HIDDEN 化されている。
  - 診断アーキテクチャでは、Viewer 視点の判断文脈比較（Tier 1）と、客観的盤面停滞検知（Tier 2）を明確に分離して処理する。

---

## 26. Diagnostic Observer Architecture
診断アーキテクチャのコンポーネント構成：

```
+---------------------------------------------------------------------------------+
|                                GameSession                                      |
|                                                                                 |
|   +-------------------+                     +-------------------------------+   |
|   |   pendingDecision |                     |      CoreFlowCoordinator      |   |
|   +-------------------+                     +-------------------------------+   |
+---------------------------------------------------------------------------------+
                                       |
                   Read-only Passive Inspection (Zero Mutation)
                                       v
+---------------------------------------------------------------------------------+
|                       SemanticStallCycleDetector (Passive)                      |
|                                                                                 |
|  1. Capture Tier 1 / Tier 2 Snapshots                                           |
|  2. Canonicalize Dynamic IDs (Preserve Topology)                                |
|  3. Serialize Canonical JSON (Sorted Keys, Preserved Array Order, Exact Floats) |
|  4. Compute SHA-256 (32 bytes / 64 hex chars)                                   |
|  5. Update Ring Buffer (M=64) & Inverted Hash Index                             |
|  6. Evaluate Signals (Stall Count, Recurrence Window, Period Length)            |
|  7. Emit Diagnostic Event (Telemetry Only, No Feedback into Engine)             |
+---------------------------------------------------------------------------------+
```

- **非侵襲性**: エンジンの内部状態、意思決定、勝敗判定、乱数列へ一切フィードバックしない。
- **無効時設計**: 診断フラグが無効（デフォルト）の場合、一切のオーバーヘッドおよびメモリ確保を行わない設計目標（`near-zero/no allocation when disabled`）を追求する。

---

## 27. Detection Signals
診断検出器が出力するシグナル仕様（すべて診断テレメトリであり、対戦結果ではない）：

1. `NO_SIGNAL`: 正常なゲーム進展。
2. `REPEATED_STRUCTURAL_FINGERPRINT`: 同一の構造的盤面フィンガープリント（Tier 2）が $N$ 回連続して観測された（意味的盤面停滞）。
3. `REPEATED_DECISION_REQUEST`: 同一の判断要求意味的フィンガープリント（`drsf1`）が $N$ 回連続して観測された。
4. `REPEATED_POLICY_INPUT`: 同一のポリシー入力数値フィンガープリント（`gpif1`）が $N$ 回連続して観測された。
5. `PERIODIC_FINGERPRINT_CANDIDATE`: リングバッファ（$M=64$）内において、周期 $k$ ステップ前に同一のフィンガープリントが存在し、それが複数回繰り返された（周期循環候補）。
6. `NO_SEMANTIC_CHANGE_WINDOW`: 指定した決定ウィンドウ（例: 20 決定）の間、意味的状態の更新回数が閾値未満であった。

---

## 28. Cycle Proof Boundary
- **保守的用語の徹底**:
  - `DETERMINISTIC_CYCLE として確定`、`無限ループの数学的証明`、`完全デッドロック` などの表現を厳禁とする。
  - 使用する用語は **`Periodic Fingerprint Candidate`**、**`Repeated Structural Fingerprint`**、**`Repeated Decision Context`**、**`Cycle Candidate`** に限定する。
- **理由**:
  - 同一のフィンガープリントが再訪されたとしても、未消費の乱数ストリーム（シャッフル）、非対称なプレイヤー思考、手札の隠匿情報によって将来ループを脱出する可能性が数学的に存在する。

---

## 29. False Positive Analysis
1. **意図的なロングゲーム**:
   - プレイヤー双方が防御的な好手を打ち続け、盤面が膠着しているが、わずかなリソース消費（手札枚数やライフ等）が発生しているケース。
   - **対策**: 単に決定数が長いだけのゲームを誤検知しないよう、リソース更新があればフィンガープリントが変化する設計とする。
2. **偶発的な盤面再訪**:
   - 一進一退の攻防（アタックと回復）により、数ターン後に偶然同じライフ・手札・ユニット構成に戻るケース。
   - **対策**: 単発の再訪をもってサイクルと判定せず、周期的な反復（$k$ ステップごとの 2 回以上の反復）を確認する。

---

## 30. False Negative Analysis
1. **マルチターン・パスループ**:
   - プレイヤー双方が何もせず PASS を連打してターンだけが進むケース。
   - `turnCount` がインクリメントされるため、Turn-Aware フィンガープリント（Variant S1）では毎ターン異なるハッシュ値となり見逃す。
   - **対策**: `turnCount` を除外した Variant S2（Turn-Invariant）フィンガープリントを併用して捕捉する。
2. **Bookkeeping の漏れによる偽の差異**:
   - リクエストの絶対シーケンス番号や動的 ID のプレフィックス違いにより、同じ状況が異なるハッシュ値となるリスク。
   - **対策**: Canonical ID 置換およびシーケンス番号の相対インデックス化により確実に抽象化する。

---

## 31. Hash / Serialization Contract
新診断フィンガープリントのシリアライズおよびハッシュ仕様：

1. **暗号学的ハッシュ関数**:
   - **アルゴリズム**: SHA-256（`crypto.createHash('sha256')`）
   - **ダイジェストサイズ**: 32 bytes
   - **文字列表現**: 64 文字の小文字 Hex 文字列
   - **プレフィックス体系**:
     - `sgf1-<64 hex>`: Structural Gameplay Fingerprint (Variant S1)
     - `sgf1-ti-<64 hex>`: Structural Gameplay Fingerprint (Variant S2, Turn-Invariant)
     - `pof1-<64 hex>`: Player Observation Fingerprint
     - `drsf1-<64 hex>`: Decision Request Semantic Fingerprint
     - `gpif1-<64 hex>`: Genome Policy Input Fingerprint
     - `ccf1-<64 hex>`: Continuation Context Fingerprint (Research Candidate)
2. **正規化シリアライザ (Canonical JSON Serialization)**:
   - オブジェクトのキーを Unicode コードポイント昇順で再帰的にソート。
   - 余分な空白・改行を含まないコンパクト表現。
   - 浮動小数点数は完全な精度でシリアライズ（`-0` は `0` に正規化）。丸め処理は行わない。
3. **Existing StateHasher との厳格な分離**:
   - `StateHasher.ts` は FNV-1a 64-bit（`sh2-<16 hex>`）であり、本診断ハッシュと混同しない。

---

## 32. Memory / History Bound Design
- **リングバッファサイズ ($M=64$)**:
  - 直近 $M$ ステップのフィンガープリントおよび決定情報を保持。
  - 周期 $k \in [1, M/2]$ の反復パターンを効率的に検出。
- **逆引きハッシュインデックス ($U_{\text{map}}$)**:
  - フィンガープリント文字列から直近出現インデックスへのマッピング。
  - $O(1)$ lookup で過去の再訪有無を判定。
- **メモリ上限**:
  - 1 決定あたりのフィンガープリント文字列保持量は約数百バイト。
  - $M=64$ エントリのバッファおよびインデックスによる追加メモリフットプリントは 1 マッチあたり数キロバイト程度に制限され、プロセスあたり 5MB 未満に厳格に抑えられる設計見積もり。

---

## 33. Complexity Analysis & Performance Non-Claims
- **フィンガープリント生成時間計算量**:
  $O(N_{\text{entities}} + N_{\text{patterns}} \cdot (D_{\text{pattern}} + D_{\text{context}}))$
  ここで $N_{\text{entities}}$ は盤面要素数、$N_{\text{patterns}}$ は合法手候補数、$D_{\text{context}} = 163$、$D_{\text{pattern}} = 143$。
- **再訪・周期検索時間計算量**:
  ハッシュマップ lookup による平均 $O(1)$、最悪 $O(M)$（$M=64$）。
- **空間計算量**:
  $O(M \cdot H_{\text{size}} + U_{\text{map}})$
  ここで $M=64$、$H_{\text{size}}=64$ 文字。
- **ベンチマーク未実施の明記 (`DESIGN ESTIMATE / NOT BENCHMARKED`)**:
  - 本作業は設計（DESIGN ONLY）であり、実行時ベンチマークは一切実施されていない。
  - したがって、特定の実測時間（ミリ秒/マイクロ秒）やオーバーヘッド比率に関する断定的主張は行わない。
  - 実測オーバーヘッドは将来の Implementation Evidence 作業において正式に計測・報告する。

---

## 34. Diagnostic Trace Contract
診断機能が有効化された場合に出力されるトレースイベントのスキーマ：

```json
{
  "stepIndex": 42,
  "turnCount": 3,
  "activePlayer": "p1",
  "decisionSource": "ACTION_REQUEST",
  "fingerprints": {
    "structural": "sgf1-a1b2c3...",
    "structuralTurnInvariant": "sgf1-ti-d4e5f6...",
    "observation": "pof1-789abc...",
    "decisionRequest": "drsf1-def012...",
    "policyInput": "gpif1-345678..."
  },
  "diagnostics": {
    "structuralStallCount": 0,
    "policyInputStallCount": 0,
    "cycleCandidate": null,
    "signal": "NO_SIGNAL"
  }
}
```

---

## 35. Match Outcome Contract
- **対戦結果への不干渉**:
  - 診断シグナル（例: `REPEATED_STRUCTURAL_FINGERPRINT` や `PERIODIC_FINGERPRINT_CANDIDATE`）が発生した場合でも、対戦結果（`GameResult`）を `DRAW` や `FAILED` へ強制変更しない。
  - `maxDecisions = 500` 到達時の公式ステータスは、既存契約通り **`INCOMPLETE`** を維持する。
  - 診断シグナルはメタデータおよびテレメトリとしてのみ記録される。

---

## 36. Future Test Matrix
将来の実装フェーズ（Implementation）において必須となるテストケース一覧：

1. **カタログメタデータ差異の検知**:
   - 同一の `actionSelectionRef: 0` であっても、参照先 `catalog.actions[0]` の `actionId` や `speed` が異なる場合、`drsf1` および `gpif1` が不一致となること。
2. **カード・ユニット選択内容の検知**:
   - 同一の `keyCardSelectionRef` / `keyUnitSelectionRef` であっても、参照先 `cardIds` / `unitIds` の実体属性が異なる場合、フィンガープリントが不一致となること。
3. **コスト支払い内容の検知**:
   - `costPayments` の `discardedCardIds` や `lifeCount` が異なる場合、フィンガープリントが不一致となること。
4. **対象・効果選択内容の検知**:
   - `targetSelections` や `effectSelections` の実体値が異なる場合、フィンガープリントが不一致となること。
5. **UI 表示文字列（`primaryLabel`, `secondaryLabel`, `summary`）の透過性**:
   - `primaryLabel` や `secondaryLabel` の文字列のみが異なり、その他の全意味的プロパティが同一である場合、`gpif1` および `drsf1` が完全一致すること。
6. **フォグバインディング（`fog.bindings`）の意味論的検知**:
   - `fog.bindings` の `target` または `amount` が異なる場合、`sgf1` および `gpif1` が不一致となること。
7. **未使用カタログエントリの無干渉**:
   - どのパターンからも参照されていない余分なカタログエントリが存在しても、`gpif1` および `drsf1` の意思決定等価性が損なわれないこと。
8. **Bookkeeping の完全透過性**:
   - `decisionId` や `stateVersion` のみが異なり、その他が完全同一の 2 つのリクエストにおいて、`gpif1` が完全一致すること。
9. **パターン順序の感度**:
   - パターン集合が同一で並び順のみが異なる場合、`gpif1` および `drsf1` が不一致となること（タイブレーク感度の保証）。
10. **特徴量エンコーダー出力との完全同値性**:
    - `DecisionFeatureEncoder.encode(requestA)` と `encode(requestB)` の完全ディープイコールと、`gpif1` の一致が同値（必要十分）であることの検証。
11. **Continuation 境界の検証**:
    - 同一盤面であっても、導出された `rulePackage.contentDigest` や `runtimeShuffleCount` が異なる場合に Continuation candidate が不一致となること。

---

## 37. Future Performance Evidence Plan
実装完了後に実施すべき性能評価計画：

1. **ベースライン計測**: 診断機能無効時の対戦スループット（decisions/sec）およびメモリ消費。
2. **診断有効時計測**: 診断機能を有効化した際のスループット低下率および決定あたりの平均/p95 オーバーヘッド。
3. **ピークメモリ計測**: リングバッファおよびハッシュインデックスによるプロセスあたりの追加メモリ消費。
4. **Controlled N=6 診断実行**: A/B Evidence で特定された 28 件の INCOMPLETE 対戦に診断を適用し、停滞・サイクルの発生状況を実測。

---

## 38. Future Implementation Boundary
- **本成果物のスコープ**:
  - 本設計書 (V1-R3) およびフィールドレジストリ (V1-R3) は **DESIGN ONLY** である。
  - プロダクションコード（`src/**`）、テストコード（`tests/**`）、ルール定義、ビルド成果物（`dist/**`）への変更は一切含まれない。
- **次期タスク境界**:
  - 実装は独立レビュー通過後、次期 Work ID: `BP-SIM-AI-SEMANTIC-STALL-CYCLE-IMPL-V1` において着手する。

---

## 39. Roadmap Position & Acceptance Criteria
`tools/simulator/docs/ai-self-play-roadmap.md` における本設計の位置づけ：

- `BP-SIM-AI-FEATURE-SCALING-AB-EVIDENCE-V1-R1`: `FORMAL ACCEPTED` (SHA: `97d2ac1fa2db79f459c75e4f1fd19486125d1ef6`)
- `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1`: `NOT ACCEPTED / SUPERSEDED BY R1` (SHA: `6ab04120fb3cfc9dccf4cf04f9c824e091af374d`)
- `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R1`: `NOT ACCEPTED / SUPERSEDED BY R2` (SHA: `81433f8e5cdcec44bcffca51ce476f0d2e1b8fbe`)
- `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R2`: `NOT ACCEPTED / SUPERSEDED BY R3` (SHA: `14de5ffd567a099b27ec7c23389741d2859e2491`)
- `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R3`: **`DESIGNED / PENDING INDEPENDENT REVIEW`** (本作業)
- `Semantic Diagnostic Implementation`: `NOT STARTED / WAITING FOR INDEPENDENT REVIEW`
- `Diagnostic Controlled Evidence`: `NOT STARTED`
- `Competitive Stall Escape`: `NOT STARTED`
- `Test / Adversarial DNA`: `NOT STARTED`
- `Controlled Multi-Generation`: `WAITING`

---

## 40. Final Design Status
本設計書 `BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R3` は、V1-R2 で指摘された Canonical Source 参照の不整合および Runtime Field / Derived Candidate の混同を完全に解消し、プロダクション実装へ進むための論理的・構造的準備を完了しました。

**Final Status**: **`READY FOR INDEPENDENT REVIEW`**
