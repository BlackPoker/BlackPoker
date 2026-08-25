# BlackPoker Simulator Architecture (Phase 21B.3)

## 1. アーキテクチャ基本原則

BlackPoker Simulator は、以下の4つのユースケースすべてにおいて**同一の Core Flow / GameSession / RulePackage** を使用します。

1. **React UI**: 人間同士（または人間 vs AI）がブラウザ上で操作して遊ぶ
2. **Headless Simulation**: UIなしで AI や DecisionPolicy 同士を自動対戦させる
3. **CLI Match Runner**: CI / CLI 環境で大量シミュレーションや整合性検証を実行する
4. **統合テスト / ユニットテスト**: テストコードから `GameSession` を直接進めて特定状態を検証する

UI専用のゲームルールや判定ロジックは一切存在せず、UI を完全に削除してもゲームエンジンは独立して完全に動作します。

---

## 2. モジュール依存方向

すべてのモジュールは上位から下位への単方向依存を厳格に維持します（下位から上位への逆依存はテストで禁止されています）。

```
data/rules-vnext (YAML定義)
        ↓
RulePackage (型・定義)
        ↓
engine/rules (ルール評価・バリデーション・DSL解釈)
        ↓
engine/decision (パターン生成・コスト/対象列挙)
        ↓
engine/session/GameSession (コアフロー・状態遷移)
        ↓
DecisionRequest / Observation (構造化プロトコル)
      ┌────────┴────────┐
Human React UI       DecisionPolicy / AI / CLI Runner
      └────────┬────────┘
DecisionResponse (選択された合法パターンRef)
        ↓
engine/session/GameSession (状態更新)
```

---

## 3. Decision Protocol (DecisionRequest & DecisionResponse)

UI、AI、CLI Runner、テストはすべて同一の Decision Protocol で通信します。

- **`DecisionRequest`**:
  - `playerId`: 判断権を持つプレイヤー（`p1` / `p2`）
  - `source`: 要求元種別（`ACTION_REQUEST` / `EFFECT_RESOLUTION`）
  - `patterns`: Engine が生成した排他的な合法選択肢（Legal Patterns）の一覧
  - `catalog`: 選択肢の構造化データ（アクション、キーカード、コスト、対象、効果選択）
  - `observation`: そのプレイヤーに公開されている盤面スナップショット（非公開情報は隠蔽）
- **`DecisionResponse`**:
  - `decisionId`: 対応する要求 ID
  - `stateVersion`: 要求受信時の盤面バージョン
  - `selectedPatternRef`: 選択したパターンのインデックス

### UI / AI の責務
- UI や AI は合法性を独自計算しません。
- UI は `catalog` と `observation` を照合して人間可読に描画（①/② 番号、スート記号、カード名など）するだけの View 層です。
- AI や Policy（`FirstLegalPolicy`, `ScriptedPolicy`）は `DecisionRequest.patterns` から 1 つを選択して返します。

---

## 4. Headless Simulation 基盤

ブラウザや DOM、React に一切依存せず、Node.js 環境でゲームセッションを進行するための基盤を提供しています。

### `DecisionPolicy`
```typescript
export interface DecisionPolicy {
  choose(request: DecisionRequest): DecisionResponse;
}
```
- `FirstLegalPolicy`: 合法パターンの先頭（PASS以外優先またはPASS優先）を選択する基本Policy。
- `ScriptedPolicy`: スクリプト関数に基づき、特定のアクションや条件でパターンを選択するPolicy。

### `SimulationRunner`
```typescript
const result = SimulationRunner.run(session, policies, { maxDecisions: 500 });
```
- `GameSession.advance()` と `session.submitDecision()` のみを呼び出し、ゲーム終了（`FINISHED`）または上限到達まで自動対戦を実行します。

---

## 5. アクション使用制限 DSL (`usageLimit`)

公式ルールの「Attack は 1 ターンに 1 回まで」などは、YAML 定義と Engine の汎用 DSL として駆動します。

```yaml
actions:
  - id: action.attack
    name: アタック
    request:
      trigger: direct
      speed: normal
      timing: main
      usageLimit:
        scope: turn
        max: 1
```

- **状態管理**: `state.turnUsage[playerKey][actionId]` で当ターンのリクエスト回数を記録。`TurnManager.startTurn` でリセット。
- **合法性判定**: `LegalPatternGenerator` で上限到達時に候補から除外。`ActionRequestValidator` で上限超過の直接リクエストを拒否。
- 0体 Attack を選択した場合でも使用回数がカウントされ、同ターン内の 2回目 Attack は禁止されます。次ターンの自分の手番で再び使用可能になります。
