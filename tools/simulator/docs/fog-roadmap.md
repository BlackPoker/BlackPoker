# Fog（フォグ）システムの実装状況とロードマップ

## 1. 現状の実装ステータス

### A. Core Primitives: IMPLEMENTED
ルールエンジン（`rules-vnext`）において、以下の基盤機能が完全実装されています。
- **fog zone**: 各プレイヤーのゲーム状態領域（`GameState.players[pKey].fog`）
- **Fog コンポーネント定義**: `fog.up.yaml` (アップ霧), `fog.down.yaml` (ダウン霧)
- **createFog 命令**: キーカードを手札から Fog 領域へ移送し、バインディング（`target`, `amount`）を作成（`cardMoved` イベント発行）
- **Fog所有者非依存のサイズ計算 (`AbilityEvaluator`)**: 全プレイヤーの Fog を走査し、対象ユニットの現在サイズ（current size）を動的に合算
- **cleanupFogs 命令**: ターン終了（End アクション解決）時に全プレイヤーの Fog カードを各オーナーの墓地（grave）へ移送

### B. Core Battle Playtest (Up / Down E2E): HARDENED / VERIFIED (Phase 21B.6.1)
- `CORE-BATTLE-001` プリセットに Up / Down キーカードおよび $D コスト用手札を合法配置
- UI 盤面で各兵士に作用している全 Fog（自他問わず）のバッジ表示（`↑ +3 ♡3`, `↓ -2 ♠2` 等）
- 兵士ユニットの現在サイズ（Engine 計算値）のリアルタイム表示
- 戦闘（DamageJudge / Direct Damage）への Fog サイズ反映、防壁の rank matching 独立性の維持

### C. 未実装のアクション・Fog種類 (今後のロードマップ)
- **Phase 22 以降**:
  - `action.force` (フォース / 攻撃強制Fog)
  - `action.close` (クローズ / 防御封じFog)
  - 切札や特殊能力による Fog の操作・解除アクション
