# BlackPoker Gen 9 実戦品質改善 完了報告書 (v7.2c / v7.3c 最終受入れ版)

**Work ID:** `BP-SIM-AI-GEN9-PRACTICAL-BEHAVIOR-IMPROVEMENT`  
**対象ブランチ:** `BlackPoker/issue551-core-flow`  
**基準Commit:** `37fd04becb74d1a9d58955277498e77ae8df59bf`  
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

さらに、最終受入れレビューにおいて指摘された CI テストの追従、確定リーサル評価の厳密化、相手ドライブ兵士の反撃リスク評価、および新旧 Evidence の整合性確認を完了した。

---

## 2. 改善項目と実装内容

### 2.1 P0-1：CI失敗の解消 (`evolutionPlaytestIntegration.test.ts`)
- `PLAYTEST_POLICY_OPTIONS` に新バージョン 2 種（`gen9-r4-v72c`, `gen9-cost-v73c`）が追加されたことに伴い、選択肢総数が 11 から 13 へ拡張された。
- 従来の 11 種類のポリシー ID リストが完全に保持されていることを検証した上で、期待値配列に新 2 種を追加し、全 22 テストを SKIP なしで 100% 成功させた。

### 2.2 P0-2：全軍アタックの確定リーサル評価の厳密化
- **対象ロジック:** `Gen9LearnableTacticalPolicy.evaluateAttackerSelectionTactics`
- **問題点:** アタッカーの合計サイズのみから確定リーサルを判定していたため、相手にブロッカーがいる局面や相手ライフが非公開（10以上）の局面でも誤って確定リーサルボーナスが付与されるリスクがあった。
- **改善実装:**
  1. **相手ブロッカーの厳格判定:** 相手フィールドにチャージ状態の兵士または防壁（ブロッカー候補）が 1 体でも存在する場合、合法なブロック割り当てにより阻止される可能性があるため、確定リーサルとはみなさない。
  2. **非公開ライフの除外:** `oppView.lifeCount` が確定した数値（9枚以下）の場合のみ公開情報として扱い、10枚以上（`lifeCount === undefined`）の場合は推測で確定扱いしない。
  3. **ボーナス条件:** 相手ブロッカーが 0 体、かつ公開確定ライフ枚数に対しアタッカー合計攻撃力が上回る場合のみ `isGuaranteedLethal = true`（リーサル加点 `+1.00`）とする。

### 2.3 P0-3：相手ドライブ兵士の反撃リスク評価
- **対象ロジック:** `Gen9LearnableTacticalPolicy.evaluateAttackerSelectionTactics`
- **問題点:** 相手陣地のチャージ兵士のみを脅威とみなしていたため、相手兵士がドライブ状態のときに「反撃脅威なし」と誤認して自陣を無防備にする全軍アタックを行ってしまう懸念があった。
- **改善実装:**
  - 相手ターン開始時に Core の `action.charge` が実行され、ドライブ状態の兵士もチャージ状態に復帰してアタッカーとなり得る。
  - したがって、反撃の脅威判定（`hasOppThreat`）において、チャージ兵士だけでなくドライブ兵士も含めた「相手の全兵士（サイズ > 0）」を評価対象とする。
  - 相手陣地に兵士が 1 体も存在しない（更地、または防壁のみ）場合のみ、確実に反撃能力なしと判定して全軍アタックを許容（ペナルティなし）する。

### 2.4 P0：不利なブロックの抑制（犬死ブロック回避・スルー選択）
- **対象ロジック:** `Gen9LearnableTacticalPolicy.evaluateBlockAssignmentTacticalFeatures`
- **改善実装:**
  - `behaviorVersion === "v7.2c"` かつ安全圏ライフ（`selfLife > 8`）において、不利ブロックペナルティを `(blockerTotalSize >= 5 ? 0.75 : 0.60) * count`（Final換算 `-0.1200` 〜 `-0.1500`）へ調整。
  - これにより、安全圏ライフではスルー（Pass: 0.0459）が不利ブロック（Block: 0.0178）を確実に上回り、合理的なスルー（ブロックなし）が選択される。
- **安全性と副作用防止:**
  - 致死ダメージ回避局面（`selfLife <= oppAtkSize`）では、致死ペナルティ `-2.5` が最優先されるため、不利ブロックであっても確実にブロックして敗北を回避する。
  - 有利ブロック（サイズ勝ち）、防壁撃破ブロック（ランク一致）、複数兵士合体ブロックは依然として `+0.20` の戦術加点が付与され、積極的にブロックする。

### 2.5 P1：改善前後の比較 Evidence 整合性確認
- 先行診断（`gen9BlockQualityDiagnostic.test.ts`）と同一の State 構造・DecisionRequest を統合テストに適用。
- **同一局面（自軍2 vs 敵5, ライフ15）での厳密なスコア比較:**
  - **旧 v7.2b:** Base(0.1378) + Tactical(-0.05) = **Final(0.0878)** > Pass(0.0459)  
    ⇒ **犬死ブロック（`["u-blk-2"]`）を選択**
  - **新 v7.2c:** Base(0.1378) + Tactical(-0.12) = **Final(0.0178)** < Pass(0.0459)  
    ⇒ **合理的なスルー（`[]`）を選択**
- これにより、同一 DecisionRequest において旧 AI の犬死ブロックが新 AI でスルーへ明確に改善されたことが実証された。

### 2.6 P2：空集合アタック（0体アタック）のUI課題
- BlackPoker 公式ルールにおいて、アタック宣言後の「アタッカー 0 体指定（空集合アタック）」は合法手であるため、決定ボタンの非活性化・無効化は行わない。
- アタッカーが0体の状態で決定が押された際、誤操作防止のための視覚的明示や確認ワンステップを設ける課題として記録。

---

## 3. テスト・検証結果の総括

統合回帰テストスイート `gen9PracticalBehaviorImprovement.test.ts` を実行し、全15件の検証シナリオがすべて PASS した。

| # | 検証シナリオ | 期待挙動 | v7.2c / v7.3c 結果 | 判定 |
| :---: | :--- | :--- | :--- | :---: |
| 1.1 | 有利な兵士ブロック (自軍6 vs 敵3, ライフ15) | 積極的にブロック選択 | `u-blk-6` でブロック (didBlock: true) | **PASS** |
| 1.2 | 不利なブロック回避 (自軍2 vs 敵5, ライフ15) | 犬死を避けスルー選択 | 旧v7.2bは犬死ブロック、新v7.2cはスルー選択 | **PASS** |
| 1.3 | 致死ダメージ回避ブロック (自軍2 vs 敵5, ライフ4) | 犬死でも致死回避ブロック | `u-blk-2` でブロック (didBlock: true) | **PASS** |
| 1.4 | 防壁による撃破ブロック (防壁♢5 vs 敵5) | アタッカー撃破ブロック | `u-blk-bw5` でブロック (didBlock: true) | **PASS** |
| 1.5 | 複数兵士合体ブロック (自軍4+4 vs 敵6) | 合体有利ブロック | `u-blk-4-1` + `u-blk-4-2` でブロック (didBlock: true) | **PASS** |
| 1.6 | ブロック可能候補 0 体 | 自動スルー (0体ブロック) | パターン数 1 (didBlock: false) | **PASS** |
| 1.7 | 通常列挙 vs ストリーミング列挙 | 完全一致 (パリティ) | 選択パターン・スコア 100% 一致 | **PASS** |
| 2.1 | 兵士温存が合理的な局面 (自軍2体, 敵2体, 防壁なし) | 1体を残してアタック | 1体選択 (温存ボーナス獲得, didReserve: true) | **PASS** |
| 2.2A| 相手ブロッカーありの局面 (敵チャージ兵士3) | 確定勝利とみなさず温存 | 1体温存選択 (確定リーサルボーナスなし) | **PASS** |
| 2.2B| 相手ブロッカーなし・公開確定ライフの局面 | 確定リーサル全軍アタック | 全軍アタック選択 (リーサルボーナス獲得) | **PASS** |
| 2.2C| 相手ライフ非公開(10以上)の局面 | 推測で確定扱いせず温存 | 1体温存選択 (確定リーサルボーナスなし) | **PASS** |
| 2.3 | チャージ防壁がある局面 (自陣防壁♢5) | 全軍アタック | 全軍アタック選択 (防壁あり許容) | **PASS** |
| 2.4A| 相手ドライブ兵士が存在する局面 | 次ターン反撃脅威ありで温存 | 1体温存選択 (無防備化防止) | **PASS** |
| 2.4B| 相手兵士が0体(更地)の局面 | 反撃脅威なしで全軍アタック | 全軍アタック選択 (反撃なし許容) | **PASS** |
| 3.1 | GameSession 実戦統合 (固定シード実戦対戦) | アタック〜ブロック〜ダメージ追跡 | AIが合体ブロック実行、正常解決 | **PASS** |

### 全体回帰テストおよびビルド
- `evolutionPlaytestIntegration.test.ts` (22 tests): **全PASS**
- `gen9BlockQualityDiagnostic.test.ts` (7 tests): **全PASS**
- `gen9FinalBehaviorImprovement.test.ts` (16 tests): **全PASS**
- `gen9PlaytestIntegration.test.ts` (14 tests): **全PASS**
- `gen9PracticalBehaviorImprovement.test.ts` (15 tests): **全PASS**
- **総合計: 74 tests 全件 PASS**
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
   - [`tools/simulator/src/tests/ai/evolutionPlaytestIntegration.test.ts`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/tests/ai/evolutionPlaytestIntegration.test.ts)
3. **エビデンス:**
   - [`tools/simulator/evidence/gen9_practical_behavior_improvement.json`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/evidence/gen9_practical_behavior_improvement.json)
4. **ドキュメント:**
   - [`tools/simulator/docs/ai/GEN9_BLOCK_QUALITY_DIAGNOSTIC_REPORT.md`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/docs/ai/GEN9_BLOCK_QUALITY_DIAGNOSTIC_REPORT.md)
   - [`tools/simulator/docs/ai/GEN9_PRACTICAL_BEHAVIOR_IMPROVEMENT_REPORT.md`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/docs/ai/GEN9_PRACTICAL_BEHAVIOR_IMPROVEMENT_REPORT.md)
