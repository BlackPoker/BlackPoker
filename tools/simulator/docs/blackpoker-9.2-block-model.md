# BlackPoker 9.2 Block モデル設計仕様書

## 1. 概要と背景

BlackPoker 9.2 では、公式戦闘処理の明確化および UI/Core 分離の対称性を高めるため、**「ブロック（Block）」アクションの定義構造を根本的に改定**しました。

従来の 9.1.2 仕様では、Block アクションの `controller` と `definitionOwner` が攻撃側プレイヤー（`turnPlayer`）に帰属しており、実際にブロッカーを指定する防御側プレイヤー（`nonTurnPlayer`）との間で `controller` と `decisionPlayer` の分離・特殊指定が必要でした。

9.2 では、**「Block アクションの controller および definitionOwner を非ターンプレイヤー（nonTurnPlayer）自身とする」** 公式モデルへ移行しました。

---

## 2. 9.1.2 と 9.2 の仕様比較

| 項目 | 9.1.2 従来仕様 | 9.2 新仕様 |
| :--- | :--- | :--- |
| **controller** | `turnPlayer` (攻撃側) | **`nonTurnPlayer` (防御側)** |
| **definitionOwner** | `turnPlayer` (攻撃側) | **`nonTurnPlayer` (防御側)** |
| **誘発条件 (triggerCondition)** | `actionResolved(action.attack)` | `actionResolved(action.attack)`<br>**`sourceController: opponent`**, `hasAttacker: true` |
| **効果記述 (Effect)** | `selectBlockAssignments`<br>`decisionPlayer: opponent`<br>`relation: decisionPlayer` | `selectBlockAssignments`<br>**`relation: self`**<br>(特殊な `decisionPlayer` 指定を撤廃) |
| **DamageJudge 誘発条件** | `actionResolved(action.block)` | `actionResolved(action.block)`<br>**`sourceController: opponent`** |
| **DamageJudge controller** | `turnPlayer` | `turnPlayer` |
| **複数体ブロック** | （兵士複数体ブロックはルール上許可されていたが、定義・UI連携が限定的） | **1アタッカーへの複数兵士ブロック完全対応**<br>(全合法パターン列挙 & 割当て型UI) |

---

## 3. 9.2 Block モデル採用の設計理由

1. **選択権とコントローラーの一致**:
   ブロッカーを指定する主体（NTP）と、アクションの実行主体（controller）が一致するため、DSL の `relation: self` が自然に「防御側のフィールド」を指すようになります。
2. **非公開情報モデル (Observation) との自然な適合**:
   Block 解決時の `DecisionRequest.playerId` が NTP となり、`ObservationFactory` は NTP 視点の個人公開情報を自然に提供します（自分の裏向き防壁は `KNOWN` で数字可視、相手の防壁は `HIDDEN` で数字秘匿）。
3. **Core / UI / AI の対称性向上**:
   Human UI、Headless Policy、AI のすべてにおいて、NTP への DecisionRequest として同じデータ構造・Legal Pattern が渡され、UI 専用の特殊例外処理を完全に排除できます。

---

## 4. 複数体ブロック（Multi-Soldier Block）仕様

9.2 公式ルールに基づき、以下のブロック妥当性規則を厳密に定義・実装しています：

- **0体ブロック（ブロックなし）**:
  アタッカーごとにブロッカーを指定しない（0体指定）ことが常に合法。
- **1対1ブロック**:
  チャージ状態かつ防御ラベルを持つ任意のキャラクター（一般兵または防壁）1体でブロック可能。
- **1アタッカーへの複数体ブロック**:
  - 1体のアタッカーに対して2体以上のブロッカーを指定する場合、**指定する全ブロッカーが兵士（soldier）タイプである場合のみ合法**。
  - 防壁と兵士の混合ブロック、または防壁同士の複数ブロックは**不合法**。
- **ブロッカーの排他利用**:
  同一の Block アクション解決内で、1体のブロッカーを複数のアタッカーへ同時に重複割り当てすることは**不合法**。
- **戦闘判定 (DamageJudge)**:
  - 複数兵士ブロッカーの現在サイズ（current size）を合算し、アタッカーのサイズと比較。
  - 通常ルール: サイズの小さい側が墓地へ移動（同値なら双方が墓地へ）。

---

## 5. Human UI における割当て型 Block Assignment Editor

大量のパターン（数十通り）をフラットに一覧表示するのではなく、Human UI では「各アタッカーを誰でブロックするか」をインタラクティブに指定する **`BlockAssignmentEditor`** を採用しました。

### UI/Core 原則の遵守
- UI 側で独自のブロック判定（Soldier か Bulwark か等）を再実装せず、Engine が生成した `catalog.effectSelections`（Legal Patterns）の集合を部分一致フィルタリングします。
- 選択肢の活性/非活性（disabled）は、「そのブロッカーを追加した場合に一致する Legal Pattern が 1 件以上存在するか」のみで判定されます。
- 「この割当てで決定」を押すと、現在の割当てと完全一致する既存の `patternRef` を検索して提出します。
