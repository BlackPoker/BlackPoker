# Core Battle Playtest: サポートアクション一覧 & 仕様書

## 1. 目的

BlackPoker の新ルールエンジン（`rules-vnext` YAML 定義駆動）および決定基盤（`GameSession` / `Decision`）をブラウザ上で Human vs Human として実際にプレイし、戦闘コアフロー（Attack, Block, DamageJudge, End, Charge, Draw, Quick, 勝敗判定）が公式仕様通りに動作することを確認・レビューするためのプレイテスト版です。

> [!WARNING]
> 本プレイテストは BlackPoker 9.1.2 完全実装版ではありません。コアルールの検証を目的とした短縮・固定盤面（Preset: `CORE-BATTLE-001`）でのプレイテストとなります。

---

## 2. 既知の制限事項 (Known Limitations)

> [!IMPORTANT]
> **【重要】エンド時の手札7枚超過ディスカードは未実装です**
> 現在のエンジンでは、手札が8枚以上あってもエンド時に自動ディスカードされません。本プレイテストでは手札が7枚以下となるよう初期手札2枚・ドロー枚数を設計しています。

1. **エンド時の手札7枚超過ディスカード**:
   - 現在のエンジンでは未実装です（Known Limitation）。
2. **アタックの「1ターン1回」制限 & 「このターン出た兵士」の制限**:
   - コアフローの検証を優先しているため、召喚酔い等の高度な制約は今後のフェイズで導入されます。
3. **切札・キャラクター固有能力の一部**:
   - 巨人召喚・要塞・革命等の特殊キャラクター展開は今回の短縮プリセットには配置されていません（基本戦闘ルールに集中）。

---

## 3. Playtest プリセット仕様 (`CORE-BATTLE-001`)

- **ライフ**: 各プレイヤー 8枚（`Card[]` 形式、全カード通常トランプ範囲内でユニーク）
- **Player A (p1)**:
  - 手札: 2枚（♢5, ♣2 - ツイスト用コスト）
  - フィールド: 一般兵 2体（♠6, ♡5 - charge状態）、防壁 1体（♢4 - charge状態, 裏向き）
  - 墓地: 0枚
- **Player B (p2)**:
  - 手札: 2枚（♢6, ♣3 - ツイスト用コスト）
  - フィールド: 一般兵 2体（♣6, ♢5 - charge状態）、防壁 1体（♡5 - charge状態, 裏向き）
  - 墓地: 0枚

---

## 4. 全アクション棚卸し & サポートステータス

ルールパッケージには **全17アクション**、**全7コンポーネント** がロードされます。

### A. SUPPORTED (Core Playtest Ready: 通常対戦で即座に体験可能)

| Action ID | Name | Trigger | Speed | Timing | Effect Command | Playtest Status |
|---|---|---|---|---|---|---|
| `action.attack` | アタック | direct | normal | main | `startAttack` | **SUPPORTED** |
| `action.block` | ブロック | triggered | normal | main | `selectBlockAssignments`, `declareBlock` | **SUPPORTED** |
| `action.damageJudge` | ダメージ判定 | triggered | normal | main | `judgeDamage` | **SUPPORTED** |
| `action.end` | エンド | direct | normal | main | `cleanupFogs`, `endTurn` | **SUPPORTED** |
| `action.charge` | チャージ | triggered | immediate | main | `setAllUnitState` | **SUPPORTED** |
| `action.draw` | ドロー | triggered | normal | main | `drawFromLife` | **SUPPORTED** |
| `action.twist` | ツイスト | direct | normal | quick | `toggleUnitState` | **SUPPORTED** |

### B. ENGINE SUPPORTED (Preset Dormant: エンジン実装済・固定盤面では条件非配置)

| Action ID | Name | Trigger | Speed | Timing | 状態 | 備考 |
|---|---|---|---|---|---|---|
| `action.counterattack` | 反撃 | triggered | immediate | main | **ENGINE SUPPORTED** | 要塞によるダメージ無効化時に即時誘発 |
| `action.nextGeneration` | 世代交代 | triggered | immediate | quick | **ENGINE SUPPORTED** | レガシーカード死亡時に即時誘発 |
| `action.revolutionDraw` | 革命ドロー | triggered | immediate | quick | **ENGINE SUPPORTED** | 革命下での未ブロック兵士による即時ドロー |

### C. PARTIAL / NOT PLAYABLE IN PRESET (エンジンコマンド実装済・本プリセット対象外)

| Action ID | Name | Trigger | Speed | Timing | 状態 |
|---|---|---|---|---|---|
| `action.up` | アップ | direct | normal | quick | **PARTIAL** |
| `action.down` | ダウン | direct | normal | quick | **PARTIAL** |
| `action.throwing` | 投擲 | direct | normal | quick | **PARTIAL** |
| `action.destroyBulwark` | 防壁破壊 | direct | normal | quick | **PARTIAL** |
| `action.counter` | カウンター | direct | normal | quick | **PARTIAL** |
| `action.setBulwark` | 防壁配置 | direct | normal | main | **PARTIAL** |
| `action.summonSoldier` | 兵士召喚 | direct | normal | main | **PARTIAL** |

---

## 5. コンポーネント一覧 (全7件)

1. `character.soldier` (一般兵: ランク 2..10)
2. `character.bulwark` (防壁: スーツ heart/diamond, ランク A..K, 初期 face: down)
3. `character.giant` (巨人: 防壁相打ち無効化能力)
4. `trump.fortress` (要塞: ダメージ無効化能力)
5. `trump.revolution` (革命: ダメージ判定ルール反転能力)
6. `fog.up` (アップ霧)
7. `fog.down` (ダウン霧)

---

## 6. 不具合報告方法

不具合を発見した場合は、画面右上の「**デバッグ表示**」ボタンから「**📋 デバッグ情報をコピー**」をクリックし、取得された JSON ログを添えて Issue までご報告ください。
