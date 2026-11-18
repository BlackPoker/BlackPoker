# BlackPoker Gen 9 実戦品質改善 完了報告書

**Work ID:** `BP-SIM-AI-GEN9-PRACTICAL-BEHAVIOR-IMPROVEMENT`  
**対象ブランチ:** `BlackPoker/issue551-core-flow`  
**基準Commit:** `e01b0e360e421f9caa50556940febbf355375440`  
**対象AI:** `Gen 9 R4 v7.2c` / `Gen 9 v7.3c` (公式レギュレーション: `standard-pack`)  
**作成日:** 2026-11-18  

---

## 1. 概要と改善目的

人間の実戦プレイテストにおいて「AIが弱い」「アタックがブロックされない」という問題が報告された。  
先行して実施した診断（`BP-SIM-AI-GEN9-BLOCK-QUALITY-DIAGNOSTIC`）により、以下の真因が特定された：
1. **不利ブロック過剰（自滅ブロック）:** Gen 8 DNAのブロック加点 (+0.09) がペナルティ (-0.05) を上回り、安全圏ライフでも犬死ブロックを行い、序盤〜中盤でブロッカーが早期全滅していた。
2. **全軍アタック志向による自陣無防備化:** アタック時に全兵士をアタックに投入するため、返しのターンに自軍兵士が全員ドライブ（疲労）状態となり、ブロック候補数 0 体となって自動スルーが発生していた。
3. **空集合アタック（0体アタック）のUI誤認:** 人間がアタッカーを選択せずに決定した場合、公式ルールに基づきアタックが即時終了し、ブロック要求が発生しない。

本作業では、**Gen 8 DNAの変更、再学習、Core・YAMLルールの変更を行わず**、戦術評価重みの最小限調整およびアタッカー選択戦術の導入によって実戦品質を向上させた新バージョン **`Gen 9 R4 v7.2c`** および **`Gen 9 v7.3c`** を実装・検証した。また、既存の `v7.2b` / `v7.3b` の挙動・再現性も完全に維持した。

---

## 2. 改善項目と実装内容

### 2.1 P0：不利なブロックの抑制（犬死ブロック回避・スルー選択）
- **対象ロジック:** `Gen9LearnableTacticalPolicy.evaluateBlockAssignmentTacticalFeatures`
- **問題点:** 敵アタッカーサイズ > 自軍ブロッカー合計サイズの不利ブロックにおいて、旧来のペナルティ `0.25 * count`（Final換算 `-0.05`）ではDNAの加点（`+0.09`）に負け、犬死ブロックが選択されていた。
- **改善実装:**
  - `behaviorVersion === "v7.2c"` かつ安全圏ライフ（`selfLife > 8`）において、不利ブロックペナルティを `(blockerTotalSize >= 5 ? 0.75 : 0.60) * count`（Final換算 `-0.1200` 〜 `-0.1500`）へ調整。
  - これにより、安全圏ライフではスルー（Final スコア `+0.1091`）が不利ブロック（Final スコア `+0.0096`）を確実に上回り、合理的なスルー（ブロックなし）が選択される。
- **安全性と副作用防止:**
  - 致死ダメージ回避局面（`selfLife <= oppAtkSize`）では、致死ペナルティ `-2.5` が最優先されるため、不利ブロックであっても確実にブロックして敗北を回避する。
  - 有利ブロック（サイズ勝ち）、防壁撃破ブロック（ランク一致）、複数兵士合体ブロックは依然として `+0.20` の戦術加点が付与され、積極的にブロックする。

### 2.2 P1：アタッカー選択時の兵士温存（自陣無防備化防止）
- **対象ロジック:** `Gen9TacticalPrototypePolicy` / `Gen9LearnableTacticalPolicy`
- **問題点:** アタック宣言後、アタッカー選択（`selectUnits`）において自陣の兵士を全員アタックに投入してしまい、返しのターンに自陣が全員ドライブ状態（無防備）になり、自動スルーが発生していた。
- **改善実装:**
  - 新規戦術関数 `evaluateAttackerSelectionTactics()` を実装。
  - 自陣のチャージ兵士数、アタック選択兵士数、自陣チャージ防壁の有無、相手のチャージ兵士数を評価。
  - **確定リーサル:** 相手確定リーサル時は全軍アタックに `+1.00` のリーサルボーナスを付与。
  - **防壁あり or 相手無害:** 自陣にチャージ防壁がある、または相手陣地にチャージ兵士がいない（反撃能力なし）場合は、全軍アタックにペナルティを与えずアタックを推奨。
  - **通常戦闘時:** 自陣防壁がなく相手に反撃可能な兵士がいる状況で全軍アタック（`remainingChargeSoldiers === 0`）した場合に `-0.15` の無防備ペナルティを付与し、1体以上を守備に残す選択（`remainingChargeSoldiers >= 1`）に `+0.10` の温存ボーナスを付与。
- **柔軟性の保証:** 常に1体を残す硬直ルールではなく、確定リーサル時・防壁展開時・相手無害時は柔軟に全軍アタックを選択する。

### 2.3 P2：空集合アタック（0体アタック）のUI課題
- **公式ルールの確認:** BlackPoker 公式ルールにおいて、アタック宣言後の「アタッカー 0 体指定（空集合アタック）」は合法手である。
- **方針確定:** 公式ルールを遵守し、決定ボタンの非活性化・無効化は行わない。
- **次回UI改修課題:** アタッカーが0体の状態で決定が押された際、誤操作防止のための視覚的明示や確認ワンステップを設ける課題として整理・記録。

### 2.4 Playtest UI への新バージョン統合
- `PlaytestSeatController.ts` および `PlaytestPolicyFactory.ts` に `gen9-r4-v72c` と `gen9-cost-v73c` を追加。
- プレイテスト画面のドロップダウンで旧バージョン（`v7.2b`, `v7.3b`）と新バージョン（`v7.2c`, `v7.3c`）を自由に切り替えて対戦・比較可能にした。

---

## 3. テスト・検証結果の総括

統合回帰テストスイート `gen9PracticalBehaviorImprovement.test.ts` を作成し、12件の検証シナリオをすべて PASS した。

| # | 検証シナリオ | 期待挙動 | v7.2c / v7.3c 結果 | 判定 |
| :---: | :--- | :--- | :--- | :---: |
| 1.1 | 有利な兵士ブロック (自軍6 vs 敵3, ライフ15) | 積極的にブロック選択 | `u-blk-6` でブロック (didBlock: true) | **PASS** |
| 1.2 | 不利なブロック回避 (自軍2 vs 敵5, ライフ15) | 犬死を避けスルー選択 | ブロックなし (didBlock: false, Passスコア > Blockスコア) | **PASS** |
| 1.3 | 致死ダメージ回避ブロック (自軍2 vs 敵5, ライフ4) | 犬死でも致死回避ブロック | `u-blk-2` でブロック (didBlock: true) | **PASS** |
| 1.4 | 防壁による撃破ブロック (防壁♢5 vs 敵5) | アタッカー撃破ブロック | `u-blk-bw5` でブロック (didBlock: true) | **PASS** |
| 1.5 | 複数兵士合体ブロック (自軍4+4 vs 敵6) | 合体有利ブロック | `u-blk-4-1` + `u-blk-4-2` でブロック (didBlock: true) | **PASS** |
| 1.6 | ブロック可能候補 0 体 | 自動スルー (0体ブロック) | パターン数 1 (didBlock: false) | **PASS** |
| 1.7 | 通常列挙 vs ストリーミング列挙 | 完全一致 (パリティ) | 選択パターン・スコア 100% 一致 | **PASS** |
| 2.1 | 兵士温存が合理的な局面 (自軍2体, 敵2体, 防壁なし) | 1体を残してアタック | 1体選択 (温存ボーナス獲得, didReserve: true) | **PASS** |
| 2.2 | 確定リーサルの局面 (相手ライフ1枚) | 全軍アタック | 全軍アタック選択 (リーサルボーナス獲得) | **PASS** |
| 2.3 | チャージ防壁がある局面 (自陣防壁♢5) | 全軍アタック | 全軍アタック選択 (防壁あり許容) | **PASS** |
| 2.4 | 相手無害の局面 (相手チャージ兵士 0 体) | 全軍アタック | 全軍アタック選択 (反撃なし許容) | **PASS** |
| 3.1 | GameSession 実戦統合 (固定シード実戦対戦) | アタック〜ブロック〜ダメージ追跡 | AIが合体ブロック実行、正常解決 | **PASS** |

### 既存回帰テストおよびビルド
- `gen9BlockQualityDiagnostic.test.ts` (7 tests): **全PASS**
- `gen9FinalBehaviorImprovement.test.ts` (16 tests): **全PASS**
- `gen9PlaytestIntegration.test.ts` (14 tests): **全PASS**
- `npm run build` (tsc + vite build): **成功 (型エラー 0 件)**
- `npm run playable:check` (1戦通しコアフローチェック): **正常完走 (Player A 勝利)**

---

## 4. 成果物一覧

1. **実装コード:**
   - [`tools/simulator/src/engine/ai/Gen9TacticalPrototypePolicy.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/ai/Gen9TacticalPrototypePolicy.ts)
   - [`tools/simulator/src/engine/ai/Gen9LearnableTacticalPolicy.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/ai/Gen9LearnableTacticalPolicy.ts)
   - [`tools/simulator/src/engine/playtest/PlaytestPolicyFactory.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/playtest/PlaytestPolicyFactory.ts)
   - [`tools/simulator/src/engine/playtest/PlaytestSeatController.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/engine/playtest/PlaytestSeatController.ts)
2. **テストコード:**
   - [`tools/simulator/src/tests/ai/gen9PracticalBehaviorImprovement.test.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/tests/ai/gen9PracticalBehaviorImprovement.test.ts)
3. **エビデンス:**
   - [`tools/simulator/evidence/gen9_practical_behavior_improvement.json`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/evidence/gen9_practical_behavior_improvement.json)
4. **ドキュメント:**
   - [`tools/simulator/docs/ai/GEN9_BLOCK_QUALITY_DIAGNOSTIC_REPORT.md`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/docs/ai/GEN9_BLOCK_QUALITY_DIAGNOSTIC_REPORT.md)
   - [`tools/simulator/docs/ai/GEN9_PRACTICAL_BEHAVIOR_IMPROVEMENT_REPORT.md`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/docs/ai/GEN9_PRACTICAL_BEHAVIOR_IMPROVEMENT_REPORT.md)
