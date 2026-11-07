# BlackPoker Gen 8 正式 Holdout 独立レビュー報告書

- **文書ID:** `BP-SIM-AI-V92-GEN8-HOLDOUT-INDEPENDENT-REVIEW`
- **対象Work:** Work 4-5 (`BP-SIM-AI-V92-WORK4-5-GEN8-OFFICIAL-HOLDOUT`)
- **承認Work:** Work 4-6 (`BP-SIM-AI-V92-WORK4-6-GEN8-HUMAN-PLAYTEST`)
- **Base SHA:** `c7f618e6f5ca24f75ea7318bc2f526ef822d24e6`
- **作成日:** 2026-11-07
- **レビュー種別:** 独立第三者監査・統計検証および追記訂正

---

## 1. 原本 Evidence の保護宣言

Work 4-5 において生成された正式 Holdout 成果物（エビデンス原本）は、以下のリポジトリパスに完全に保存されており、改変・削除・再実行を一切行わない厳格保護対象とします。

- チェックポイント: `tools/simulator/evidence/phase3-gen8-official-holdout/checkpoint.json`
- ハッシュマニフェスト: `tools/simulator/evidence/phase3-gen8-official-holdout/MANIFEST_SHA256.json`
- 実行チャンク (全12ファイル・240試合): `tools/simulator/evidence/phase3-gen8-official-holdout/chunks/outcomes-chunk-00000.jsonl` 〜 `chunk-00011.jsonl`
- 集計サマリー: `tools/simulator/evidence/phase3-gen8-official-holdout/holdout-summary-report.json`

原本エビデンスの SHA-256 チェックサムおよび Git Commit SHA (`c7f618e6f5ca24f75ea7318bc2f526ef822d24e6`) により、データの真正性と不変性が保証されています。

---

## 2. 統計値の確認および追記訂正

正式 Holdout 実行結果に基づき、以下の統計値を再検証し、検定分布に関する厳密な追記訂正を記録します。

### 2.1 実績値および統計諸量
- **総試合数:** 240 試合（120 座席反転ペア）
- **使用 Seed:** `350001〜350120`（完全未使用 Holdout Seed）
- **Candidate (Gen 8) 勝敗:** 147 勝 - 93 敗 - 0 引分（勝率 **61.25%**）
  - Leg 0 (P1 先攻): 74 勝 - 46 敗 (61.67%)
  - Leg 1 (P2 後攻): 73 勝 - 47 敗 (60.83%)
- **平均ペアスコア ($\bar{X}$):** **0.6125**（**61.25%**）
- **標本標準偏差 ($s$):** 0.3334
- **標準誤差 ($SE = s / \sqrt{120}$):** **0.0304**
- **両側 95% 信頼区間:** **[0.5522, 0.6728]**

### 2.2 p 値の厳密な追記訂正
- **検定統計量:** $t = \frac{0.6125 - 0.50}{0.03044} = 3.6959$
- **標準正規分布近似 (Z近似) による片側 p 値:** $p \approx 0.0001096$
- **自由度 119 の Student's t 分布に基づく片側 p 値:** **約 0.0001663** ($1.663 \times 10^{-4}$)
- **追記訂正の結論:**
  - 標本数 120 ペアに対する Student's t 分布の裾の厚さを考慮した厳密な p 値は **約 0.0001663** です。
  - Z 近似 ($0.0001096$) と t 分布 ($0.0001663$) のいずれを適用した場合においても、$p < 0.0002$ であり、有意水準 $\alpha = 0.025$ を圧倒的に下回っています。
  - したがって、**優位性判定（Superiority Gate）は「PASS（変更なし）」**であることを正式に再確認・認定します。

### 2.3 非劣性判定の確認
- **検定統計量 ($H_0: \mu \le 0.45$):** $t = 5.3385$
- **片側 p 値:** $p = 4.697 \times 10^{-8}$
- **非劣性判定（Non-Inferiority Gate）:** **PASS（変更なし）**

---

## 3. アクション採択率とゲームプレイ品質の検証

全 240 試合の Outcome 分析により、以下の定性的・戦術的改善が確認されました。

1. **盤面制圧と攻撃行動の劇的増加:**
   - 攻撃 (`action.attack`): Gen 8 は 590 回 (5.15%)、Gen 7 は 242 回 (1.98%)。約 2.6 倍の増加。
   - 召喚 (`action.summonSoldier`): Gen 8 は 678 回 (5.91%)、Gen 7 は 377 回 (3.09%)。約 1.9 倍の増加。
2. **投擲戦術の適正化:**
   - 投擲 (`action.throwing`): Gen 8 は 300 回 (2.62%)、Gen 7 は 447 回 (3.66%)。
   - Gen 7 の「投擲過多によるユニット軽視」から脱却し、ユニット展開・攻撃と投擲によるトドメが共存。
3. **ゲーム健全性:**
   - 500 意思決定上限到達: 0 件
   - ルールエラー / インスタンス化失敗: 0 件
   - 平均ターン数: 5.17 ターン

---

## 4. 独立レビュー総合判定

**総合判定: 正式 Holdout 評価基準を完全に充足し、Playtest 人間対戦評価への接続を承認。**

Gen 8 Candidate (`gen8-prod-g0-ind7-cross7`, Digest: `11fff0f578c92af376eece46ff90f9eba3785e59d0cf64d5eeffc7967946445e`) は、統計的優位性および意思決定品質の双方において公式基準を満たしており、ブラウザ Playtest への実装および人間プレイヤーによる実戦評価の実施が正当であると認めます。
