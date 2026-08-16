# BlackPoker シミュレーター：人間・AI共通Decision方式 仕様書

## 1. 概要

本ドキュメントは、BlackPoker シミュレーターにおける「人間・AI共通Decision方式」の設計仕様、アーキテクチャ、データモデル、および利用方法を定義するものです。

従来のシミュレーターでは、人間の画面操作（UIイベント）とAIの意思決定ロジックが異なる経路でルールエンジンに命令を発行する構成になっていましたが、本仕様により**「エンジンから合法な完成パターン全件を提示し、人間もAIも同じ合法手番号（`selectedPatternRef`）を選択してエンジンに返却する」**共通Decisionインターフェースへ移行しました。

---

## 2. アーキテクチャ

```text
       ┌───────────────────────────────┐
       │           GameState           │ (完全なゲーム内部状態)
       └──────────────┬────────────────┘
                      │
                      ▼
       ┌───────────────────────────────┐
       │      ObservationFactory       │
       └──────────────┬────────────────┘
                      │ (非公開情報: 相手手札等は HIDDEN 化)
                      ▼
       ┌───────────────────────────────┐
       │     LegalPatternGenerator     │ (アクション × キー × コスト × 対象)
       └──────────────┬────────────────┘
                      │
                      ▼
       ┌───────────────────────────────┐
       │        DecisionRequest        │
       │  - stateVersion / decisionId  │
       │  - observation (閲覧視点盤面) │
       │  - catalog (共有カタログ)     │
       │  - patterns (合法パターン配列)│
       └───────┬───────────────┬───────┘
               │               │
     (人間席)  │               │  (AI席)
               ▼               ▼
    ┌────────────────────┐   ┌───────────────────────────┐
    │   DecisionPanel    │   │     BlackPokerPolicy      │
    │ (React UI コンポ)  │   │ - FirstLegalPatternPolicy │
    │ 段階的絞り込み     │   │ - RandomPolicy            │
    │ Action→Key→Cost→Tgt│   │ - 将来の強化学習 / MCTS    │
    └──────────┬─────────┘   └─────────────┬─────────────┘
               │                           │
               └───────────────┬───────────┘
                               │
                               ▼
       ┌───────────────────────────────┐
       │       DecisionResponse        │
       │  - decisionId / stateVersion  │
       │  - selectedPatternRef (Index) │
       └──────────────┬────────────────┘
                      │
                      ▼
       ┌───────────────────────────────┐
       │        PatternExecutor        │ (バリデーション & リクエスト構築)
       └──────────────┬────────────────┘
                      │
                      ▼
       ┌───────────────────────────────┐
       │        CommandRegistry        │
       │ - createRequest               │
       │ - resolveTopRequest           │
       │ - paySelection (選択コスト消費│
       └───────────────────────────────┘
```

---

## 3. データ構造・型定義

### 3.1 共有カタログ (`DecisionCatalog`)

全パターンに完全な文字列やオブジェクトを複製して保持するとメモリおよびシリアライズ負荷が増大するため、全パターンで共有可能な要素をカタログ化し、パターン側からは 0 始まりのインデックス参照（`number`）で保持します。

```typescript
export interface DecisionCatalog {
  readonly actions: readonly ActionSelection[];
  readonly cardSelections: readonly CardSelection[];
  readonly unitSelections: readonly UnitSelection[];
  readonly costPayments: readonly CostPayment[];
  readonly targetSelections: readonly TargetSelection[];
  readonly effectSelections: readonly EffectSelection[];
  readonly orderSelections: readonly OrderSelection[];
}
```

### 3.2 コスト支払いモデル (`CostPayment`)

「どのカードを捨てるか」「どの防壁をドライブするか」「ライフを何点支払うか」を明示的に確定させた支払い要素です。

```typescript
export interface CostPayment {
  readonly discardedCardIds: readonly string[];
  readonly drivenBulwarkUnitIds: readonly string[];
  readonly sacrificedUnitIds: readonly string[];
  readonly lifeCount: number;
  readonly summary?: string;
}
```

### 3.3 合法完成パターン (`LegalPattern`)

1つの合法な手（キーカード、コスト支払い、対象選択がすべて確定したもの、またはパスなどの特殊選択）を表します。

```typescript
export type LegalPatternKind = "ACTION" | "PASS" | "EFFECT_SELECTION";

export interface LegalPattern {
  readonly patternId: string;
  readonly kind: LegalPatternKind; // "ACTION" | "PASS" | "EFFECT_SELECTION"
  readonly actionSelectionRef?: ActionSelectionRef;
  readonly keyCardSelectionRef?: CardSelectionRef;
  readonly keyUnitSelectionRef?: UnitSelectionRef;
  readonly costPaymentRef?: CostPaymentRef;
  readonly targetSelectionRef?: TargetSelectionRef;
}
```

- **`PASS` の扱い**: PASS はアクション（`ActionDefinition`）ではなく、Decision 上の選択肢種別（`kind: "PASS"`）として表現されます。架空の `action.pass` を YAML や `RulePackage` に追加することなく、人間と AI が統一してパスを選択できます。

### 3.4 プレイヤー視点盤面 (`PlayerObservation`)

観戦・判断を行うプレイヤー視点の読み取り専用盤面です。
対戦相手の非公開情報（手札カードの suit / rank / value など）は `visibility: "HIDDEN"` となり、外部から不正に参照できないよう保護されます。

---

## 4. コアフロー統合と判断サイクル

### 4.1 チャンスとリクエストのフロー
1. **通常アクション（`speed: normal`）**:
   - `ActionRequest` を生成して `stage` に積載（**未解決**のまま保持）。
   - **チャンスは現在のプレイヤーが維持**（相手へ移さない）。
   - 連続PASSカウントをリセット。
   - 同じプレイヤーに次の `DecisionRequest`（さらに積めるアクション ＋ PASS）を提示。
2. **即時アクション（`speed: immediate`）**:
   - リクエスト生成後ただちに解決（`resolveTopRequest`）。
   - **チャンスは現在のプレイヤーが維持**。
3. **パス（`kind: "PASS"`）**:
   - プレイヤーがパスを選択した場合のみ、チャンスを次のプレイヤー（相手）へ移動。
   - 連続PASSカウントを +1。

### 4.2 全員連続パスとステージ解決
1. 全プレイヤーが連続してパス（2人対戦なら 2 回連続 PASS）した場合、全員連続パスが成立。
2. ルールシステムが自動的に `stage` 最上段（トップ）のリクエストを **1件だけ解決**。
3. 連続PASSカウントを 0 にリセット。
4. チャンスプレイヤーを手番プレイヤー（`turnPlayer`）へ戻す。

---

## 5. テスト・検証実績

`src/tests/decision/` 配下に包括的な自動テストを追加し、全要件の動作を保証しています。

| テストファイル | 検証項目 | 結果 |
|:---|:---|:---:|
| `coreFlow.test.ts` | 通常アクション積載（未解決）、チャンス維持、PASSによるチャンス移動、全員連続PASSでのstageトップ1件解決、即時アクション即解決、PASSの非アクション性 | PASS |
| `legalPatternGenerator.test.ts` | アップアクションの8パターン/12パターン完全生成、カタログ参照、ソート再現性、PASSパターン付与 | PASS |
| `costPaymentEnumerator.test.ts` | Dコスト（キーカード除外）、Bコスト（防壁ドライブ）、複合コスト（D+B）の列挙 | PASS |
| `patternExecutor.test.ts` | 選択したコストカード（♣2）のみが消費され他の手札（♢3）が残ること、効果解決 | PASS |
| `gameSession.test.ts` | 進行ループ、古いバージョンや不正インデックスの拒否 | PASS |
| `humanAiParity.test.ts` | 人間とAIが同一パターンを選択した場合の盤面完全一致 | PASS |
| `observation.test.ts` | 対戦相手の手札非公開情報保護（HIDDEN化） | PASS |

- **全テスト結果**: 26テストファイル、135テスト 全件成功
- **TypeScript ビルド**: エラー 0 件 (`tsc && vite build`)
- **シナリオ実行**: 全シナリオ（アップ、ダウン、ツイスト、アタック、ブロック、ダメージ判定等）正常完了
- **新旧YAML比較**: 差分なし
