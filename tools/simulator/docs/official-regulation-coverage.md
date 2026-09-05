# BlackPoker Simulator Official Regulation Coverage Matrix (Phase 1.0)

作業ID: `BP-SIM-REG-1.0-20260905-1240`  
最終更新: 2026-09-05  
対象レギュレーション: **ライト + エントリー16** (`light-entry16`)  
正本ルール: BlackPoker 公式ルール 第9.1.2版 (第2章, 第3.9節, 第7章, 第8.3.1.1節)

---

## 1. フォーマット・フレーム・レギュレーションの概念整理

BlackPoker公式ルールにおける対戦環境は、**「フォーマット (Format)」**と**「フレーム (Frame)」**の直積として定義されます。
単独のフレーム名（例: エントリー16）やフォーマット名（例: ライト）はレギュレーションそのものではなく、その組み合わせが**「公式対戦レギュレーション (Regulation)」**となります。

| 概念 | 識別子例 | 役割 |
|---|---|---|
| **フォーマット (Format)** | `light` (ライト) | 対戦で使用可能なアクションおよびコンポーネント（キャラクター・フォグ）の集合を定義 |
| **フレーム (Frame)** | `entry16` (エントリー16) | デッキ構築ルール（固定16枚）、初期手札枚数、プリセット配置、先攻決定などの準備手順を定義 |
| **レギュレーション (Regulation)** | `light-entry16` | フォーマットとフレームの組み合わせ。公式対戦環境の単位 |

### 1.1 「ルール上の合法性」と「推奨レギュレーション」の分離
公式ルール第9.1.2版 2.3 には次のように明記されています:
> 「BlackPokerでは、ルール上はどのフォーマットとフレームの組み合わせでも遊ぶことは可能ですが、ゲームのバランスや遊びやすさを考慮し、推奨される組み合わせを定めています。」

- **ルール上の合法性 (`ruleLegal: true`)**: ルール上、すべてのフォーマットとフレームの組み合わせ（例: `standard + entry16`, `master + entry16` 等）は対戦可能です。
- **推奨判定 (`recommended`)**: Table 2.1 に基づき、エントリー16 で公式に推奨されるフォーマットは **「ライト」のみ** です。
- **Simulator 実装判定 (`simulatorImplemented`)**: Phase 1.0 において E2E 実装されているのは **`light + entry16` のみ** です。未実装の組み合わせが要求された場合、Simulator は `SIMULATOR_NOT_IMPLEMENTED` として fail-fast します。

### 1.2 第8章との文書内差異の記録
- **第2章 (2.3 / Table 2.1)**: 「推奨 (◯) / 推奨外 (-)」として整理され、非推奨の組み合わせもルール違反とはされない一般原則が示されています。
- **第8章 (8.3.1 各フレーム)**: 従来の「◯ / ×」表記が残存しています。
- **Simulator の基準**: 第2章 2.3 の明示的な一般原則を基準とし、「×」を理由に対象の組み合わせ自体を不正（`RULE_INVALID`）とは扱いません。

---

## 2. 公式ライトフォーマット カバレッジマトリクス

公式ルール第9.1.2版 第7章に定義された 19 アクションおよびコンポーネントの網羅状況です。

### 2.1 アクションカバレッジ (19 Actions)

| No | 日本語名 | Action ID | カバレッジステータス | 備考 |
|---|---|---|---|---|
| 1 | エンド | `action.end` | **IMPLEMENTED** | 手札調整、フォグ墓地送り、ターン終了 |
| 2 | チャージ | `action.charge` | **IMPLEMENTED** | エンド解決時誘発、全キャラ charge |
| 3 | ドロー | `action.draw` | **IMPLEMENTED** | チャージ解決時誘発、ライフからドロー |
| 4 | アタック | `action.attack` | **IMPLEMENTED** | アタッカー指定・攻撃開始 |
| 5 | ブロック | `action.block` | **IMPLEMENTED** | ブロッカー指定・防御開始 |
| 6 | ダメージ判定 | `action.damageJudge` | **IMPLEMENTED** | アタッカーとブロッカーの比較・墓地送り・直接ダメージ |
| 7 | 世代交代 | `action.nextGeneration` | **IMPLEMENTED** | 絵札/Joker/A 墓地移動時誘発 |
| 8 | 防壁設置 | `action.setBulwark` | **IMPLEMENTED** | 手札1枚を裏向き防壁として配置 (Cost: L) |
| 9 | 兵士召喚 | `action.summonSoldier` | **IMPLEMENTED** | 数字2〜10のカードを一般兵として配置 (Cost: BL) |
| 10 | 英雄召喚 | `action.summonHero` | **IMPLEMENTED** | 絵札J〜Kのカードを英雄として配置 (Cost: BBL, サイズ11〜13) |
| 11 | エース召喚 | `action.summonAce` | **IMPLEMENTED** | Aのカードをエースとして配置 (Cost: L, 速攻属性) |
| 12 | 装備 | `action.mountSoldier` | **IMPLEMENTED** | 同スート兵士にカードを装備し装備兵化 (Cost: BL) |
| 13 | アップ | `action.up` | **IMPLEMENTED** | ♡A〜10で兵士サイズ加算 (Cost: D) |
| 14 | ダウン | `action.down` | **IMPLEMENTED** | ♠A〜10で兵士サイズ減算 (Cost: D) |
| 15 | ツイスト | `action.twist` | **IMPLEMENTED** | ♢A〜10でキャラクター状態変更 (Cost: D) |
| 16 | カウンター | `action.counter` | **IMPLEMENTED** | ♣A〜10で対象リクエスト無効化 (Cost: D) |
| 17 | 防壁破壊 | `action.destroyBulwark` | **IMPLEMENTED** | ♡A〜K または ♢A〜K で防壁破壊 |
| 18 | 投擲 | `action.throwing` | **IMPLEMENTED** | ♠A〜K または ♣A〜K で相手に直接ダメージ |
| 19 | サーチ | `action.search` | **DECLARED_UNREACHABLE_IN_ENTRY16** | ライト定義に存在するが、Entry16にJokerがないため到達不能 |

※ CORE-BATTLE 専用の `action.counterattack`, `action.revolutionDraw` はライトフォーマットから除外されています。

### 2.2 コンポーネントカバレッジ

- **キャラクター (Characters)**:
  - 一般兵 (`character.soldier`): 数字2〜10 (1枚), ラベル [攻撃, 防御], `eligibleAsPresetSoldier: true`
  - 英雄 (`character.hero`): 絵札J〜K (1枚), ラベル [攻撃, 防御], サイズ 11〜13, `eligibleAsPresetSoldier: true`
  - エース (`character.ace`): A (1枚), ラベル [攻撃, 防御, 速攻], サイズ 1, `eligibleAsPresetSoldier: true`
  - 装備兵 (`character.armedSoldier`): 2枚以上重ねられた兵士, サイズはカード合算, A装備時速攻付与
  - 防壁 (`character.bulwark`): 任意のカード1枚裏向き, ラベル [防御]
- **フォグ (Fogs)**:
  - アップ (`fog.up`): サイズ加算効果
  - ダウン (`fog.down`): サイズ減算効果

※ 非ライトコンポーネント（`character.giant`, `character.magician` 等）はライト RulePackage から厳格に遮断されます。

---

## 3. エントリー16 フレーム仕様

### 3.1 固定16枚デッキ構成 (Jokerなし)
各プレイヤーは次の固定16枚デッキを使用します:
- **♠ スペード**: A, 2, 3, K (4枚)
- **♡ ハート**: 4, 7, J, Q (4枚)
- **♢ ダイヤ**: 5, 8, 10, Q (4枚)
- **♣ クラブ**: A, 6, 9, K (4枚)
合計: 16枚ちょうど（同一プレイヤー内での重複なし）。

### 3.2 決定論的 Seeded Shuffle
- `SeededRandom` (Mulberry32) を使用し、`Math.random()` や `Date.now()` は一切不使用。
- `matchSeed` から P1/P2 それぞれに独立した FNV-1a 乱数シード（`"p1-deck"`, `"p2-deck"`）を導出し、Fisher-Yates シャッフルを実施。
- AI Policy 用の乱数ストリームとシャッフルストリームは完全に分離。

### 3.3 ゲーム開始準備手順 (公式 3.9 & 8.3.1.1)
1. **シャッフル後 Life 化**: デッキ全体をそのまま Life として伏せる（**Deck は Zone ではない**）。
2. **初期手札**: Life 先頭から 7枚を引き Hand とする。
3. **共通プリセット配置**:
   - Life 先頭 1枚を裏向き防壁（charge）として Field へ配置。
   - Life 先頭 1枚を取り出し、RulePackage 内の `eligibleAsPresetSoldier === true` な Component（一般兵・英雄・エース）に適合するか判定し、適合すれば表向き（charge）で Field へ配置。
   - 不適格なカードは Grave へ送り、適合するまで Life から順次再試行（Life 枯渇時は公式ルール上の「敗北」）。
4. **先攻決定**:
   - 両者の Life 先頭を公開してランク比較。同値の場合は勝者が決まるまで再試行。
   - 公開したカードはすべて各プレイヤーの Grave へ。
5. **ゲーム開始**:
   - 先攻プレイヤーは Life 先頭から 1枚を Hand へドロー（先攻通常8枚、後攻7枚）。
   - `turnPlayer = firstPlayer`, `chancePlayer = firstPlayer`。
   - 準備処理中はカード移動等のゲーム内トリガーは一切発火しない。

---

## 4. プリセット兵とゲーム中召喚兵のアタック制限規則

| 区分 | 配置タイミング | 状態 | Turn 1 / 最初のターンの攻撃可否 | 理由 |
|---|---|---|---|---|
| **プリセット兵** | ゲーム開始前 (3.9.1) | `charge` | **攻撃可能** | ゲーム開始前から場に存在する正規の初期配置兵であるため |
| **ゲーム中召喚兵** (通常) | ゲーム中のターン | `charge` | **召喚ターンは攻撃不可** | 同一ターンに場に出たキャラクターであるため（同一ターン内に再 charge されても不可） |
| **ゲーム中召喚兵** (即時攻撃能力) | ゲーム中のターン | `charge` | **召喚ターンも攻撃可能** | `<速攻>` (haste) 能力を持つため（例: エース `character.ace`） |

- **ライフサイクルメタデータ**: `enteredFieldBeforeGame` (boolean) および `enteredFieldTurn` (number) により、Action ID や Component ID のハードコードなしに汎用判定されます。

---

## 5. 既知の文書差異 (Known Discrepancies)

1. **プリセット防壁の表裏**:
   - 公式PDF第9.1.2版 3.9.1 には「表向き」との記載がありますが、既存プロジェクト確定仕様および `rules-vnext` の防壁モデル（任意のカード1枚を裏向きにしたユニット）に従い、**Simulator では「裏向き」を維持**します。
2. **フレーム解説の ◯/× 表記**:
   - 公式PDF第9.1.2版 8.3.1 には旧来の ◯/× 表記が存在しますが、第2章 2.3 の一般原則（どの組み合わせもルール上対戦可能）を正本とします。

---

## 6. 未実装公式レギュレーション一覧 (将来作業)

現在 Phase 1.0 で E2E 実装された「ライト + エントリー16」以外の公式レギュレーションは未実装です:
- ライト + パック (`light-pack`)
- スタンダード + パック (`standard-pack`)
- スタンダード + レアパック (`standard-rarePack`)
- プロ + レアパック (`pro-rarePack`)
- プロ + ストラテジー (`pro-strategy`)
- マスター + ストラテジー (`master-strategy`)
- マスター + エクストラ (`master-extra`)
- マスター + ドラフト (`master-draft`)
