# Fog（フォグ）システムの位置づけと今後のロードマップ

## 1. 現状のステータス
- **現在のステータス**: **未実装 / 後続フェーズ対応**
- BlackPoker 9.2 コアバトル（Core Battle）プレイテストでは、基本戦闘サイクル（Attack / Block / DamageJudge / End / Charge / Draw / Quick）の安定稼働と UI/Core 分離を最優先としています。
- 盤面データ構造（`GameState.players[pKey].fog`）および消去処理（`cleanupFogs`）は基盤として定義されていますが、フォグの設置・発動アクション（カード効果・割り込み等の特殊ルール）は本プレイテスト段階では未実装です。

## 2. 今後の実装計画
- **Phase 22 以降**:
  - カード固有効果およびフォグ設置アクションの rules-vnext DSL 拡張
  - 割り込みタイミングにおけるフォグ発動トリガーとスタック解決
  - 非公開情報モデル（`ObservationFactory`）におけるフォグの KNOWN/HIDDEN 制御と UI 盤面描画
