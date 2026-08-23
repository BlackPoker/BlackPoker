# Core Battle Playtest: サポートアクション一覧 & 仕様書

## 1. 目的

BlackPoker の新ルールエンジン（`rules-vnext` YAML 定義駆動）および決定基盤（`GameSession` / `Decision`）をブラウザ上で Human vs Human として実際にプレイし、戦闘コアフロー（Attack, Block, DamageJudge, End, Charge, Draw, Quick, 勝敗判定）が公式仕様通りに動作することを確認・レビューするためのプレイテスト版です。

> [!WARNING]
> 本プレイテストは BlackPoker 9.1.2 完全実装版ではありません。コアルールの検証を目的とした短縮・固定盤面（Preset: `CORE-BATTLE-001`）でのプレイテストとなります。

---

## 2. 起動方法

### ローカル開発サーバー (推奨)
```bash
cd tools/simulator
npm install
npm run dev
```
ブラウザで `http://localhost:5173/` にアクセスしてください。

### Docker 環境での起動
```bash
cd tools/simulator
docker compose up app
```

### コマンドラインでの 1戦自動完走チェック
```bash
docker compose run --rm app npm run playable:check
```

---

## 3. Playtest プリセット仕様 (`CORE-BATTLE-001`)

- **ライフ**: 各プレイヤー 8枚（`Card[]` 形式）
- **Player A (p1)**:
  - 手札: 2枚（♢5, ♣2 - ツイスト用コスト）
  - フィールド: 一般兵 2体（♠6, ♡5 - charge状態）、防壁 1体（♢4 - charge状態, 裏向き）
  - 墓地: 0枚
- **Player B (p2)**:
  - 手札: 2枚（♢6, ♣3 - ツイスト用コスト）
  - フィールド: 一般兵 2体（♣6, ♢5 - charge状態）、防壁 1体（♠5 - charge状態, 裏向き）
  - 墓地: 0枚

---

## 4. 全アクション棚卸し & サポート状況

| Action ID | Name | Trigger | Speed | Timing | Effect Command | E2E Test | Playtest Status | 備考 |
|---|---|---|---|---|---|---|---|---|
| `action.attack` | アタック | direct | normal | main | `startAttack` | PASS | **SUPPORTED** | 複数アタッカー指定、0体アタック対応 |
| `action.block` | ブロック | triggered | normal | main | `selectBlockAssignments`, `declareBlock` | PASS | **SUPPORTED** | 複数ブロッカー指定、防壁ブロック対応 |
| `action.damageJudge` | ダメージ判定 | triggered | normal | main | `judgeDamage` | PASS | **SUPPORTED** | 兵士相打ち、防壁照合、未ブロック直接ダメージ |
| `action.end` | エンド | direct | normal | main | `cleanupFogs`, `endTurn` | PASS | **SUPPORTED** | ターン交代処理（7枚超過discardは未実装） |
| `action.charge` | チャージ | triggered | immediate | main | `setAllUnitState` | PASS | **SUPPORTED** | End解決後、新TPの全キャラクターがchargeへ復帰 |
| `action.draw` | ドロー | triggered | normal | main | `drawFromLife` | PASS | **SUPPORTED** | 解決時ライフに応じた枚数（>2なら2枚、<=2なら1枚） |
| `action.twist` | ツイスト | direct | normal | quick | `toggleUnitState` | PASS | **SUPPORTED** | Stage積載中の通常アクションへのQuick割り込み |
| `action.counterattack` | 反撃 | triggered | immediate | main | `dealDamage` | PASS | **SUPPORTED** | 要塞によるダメージ無効化時の即時反撃 |
| `action.nextGeneration` | 世代交代 | triggered | immediate | quick | `takeUntilLegacyCard`, `summonUnit` | PASS | **SUPPORTED** | レガシーカード死亡時の即時ユニット召喚 |
| `action.revolutionDraw` | 革命ドロー | triggered | immediate | quick | `drawFromLife` | PASS | **SUPPORTED** | 革命下での未ブロック兵士による即時ドロー |
| `action.up` | アップ | direct | normal | quick | `createFog` | PASS | **PARTIAL** | Fogエンジン実装済、Core盤面では非手札 |
| `action.down` | ダウン | direct | normal | quick | `createFog` | PASS | **PARTIAL** | Fogエンジン実装済、Core盤面では非手札 |
| `action.throwing` | 投擲 | direct | normal | quick | `dealDamage` | PASS | **PARTIAL** | ダメージエンジン実装済 |
| `action.destroyBulwark` | 防壁破壊 | direct | normal | quick | `moveToGraveyard` | PASS | **PARTIAL** | 墓地移動エンジン実装済 |
| `action.counter` | カウンター | direct | normal | quick | `cancelRequest` | PASS | **PARTIAL** | リクエストキャンセルエンジン実装済 |

---

## 5. 既知の制限事項 (Known Limitations)

1. **エンド時の手札7枚超過ディスカード**:
   - 現在のエンジンでは未実装です。プレイテスト用プリセットでは手札が7枚以下となるように設計されています。
2. **アタックの「1ターン1回」制限 & 「このターン出た兵士」の制限**:
   - コアフローの検証を優先しているため、召喚酔い等の高度な制約は今後のフェイズで導入されます。
3. **切札・キャラクター固有能力の一部**:
   - 巨人召喚・強制アタック等の特殊キャラクター展開は今回のプリセットには含まれません（基本戦闘ルールに集中）。

---

## 6. バグ報告方法

不具合を発見した場合は、画面右上の「**デバッグ表示**」ボタンから「**📋 デバッグ情報をコピー**」をクリックし、取得された JSON ログを添えて Issue までご報告ください。
