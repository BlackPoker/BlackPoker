# Gen 9 AI 完成判定の最終修正完了レポート (Work 5-7B R1)

## 1. 作業情報・改善概要

- **Work ID:** `BP-SIM-AI-GEN9-WORK57B-R1-FINAL-ACCEPTANCE`
- **対象リポジトリ:** `BlackPoker/BlackPoker`
- **対象ブランチ:** `BlackPoker/issue551-core-flow`
- **作業開始基準Commit:** `35a635777413a0c27deb642ebac29b38a9181ce7`
- **対象レギュレーション:** `standard-pack`
- **改善対象AIバージョン:**
  - **Gen 9 R4 v7.2b (完成版):** 20次元戦術評価＋行動改善版AI (`Gen9TacticalPrototypePolicy`, `behaviorVersion: "improved"`)
  - **Gen 9 v7.3b (完成版):** 24次元戦術・コスト評価＋行動改善版AI (`Gen9LearnableTacticalPolicy`, `behaviorVersion: "improved"`)
  - **過去互換AI (保護):** `gen9-r4-v72` / `gen9-cost-preview-v73` (`behaviorVersion: "legacy"`)
- **エビデンスファイル:** `tools/simulator/evidence/gen9_final_behavior_improvement_work57b.json`
- **エビデンスSHA-256:** `D39E1A04B46751E72A60D30C62BA02E92BA38F2E8F8221E6367BB5AE2BE4D568`
- **検証テストスイート:** `tools/simulator/src/tests/ai/gen9FinalBehaviorImprovement.test.ts` (15テスト全件PASS)

---

## 2. 目的と開発方針

### 背景と独立レビューでの指摘
Work 5-7Bの独立レビューにおいて、以下の重要課題が判明した。

1. **相手非公開ライフによる確定リーサル誤判定 (P0):**
   - 相手ライフが10枚以上の場合、`lifeDisplay: "10以上"` から数値 10 を抽出し、確定10枚として扱っていた。
   - 相手ライフが10枚以上のときは正確な枚数は非公開であり、確定致死（`+2.5`）と判定することはルールおよび情報遮断原則に反する。
2. **相手ライフトップへのカード移動（`addedLifeCards`）の考慮漏れ (P0):**
   - 死の槍（`moveUnitCardsToZoneTop`）等で対象兵士のカードが相手ライフトップへ移動することにより、相手ライフ枚数が増加する効果を致死判定に加算していなかった。
   - 複数カード構成の合体兵士（例: 5枚カード構成）を除去した場合、相手ライフは5枚増加するため、致死条件が変化する。
3. **ガード確実性（`guardStatus === "CERTAIN_SATISFIED"`）の要求 (P0):**
   - ガード条件が `UNCERTAIN` または `UNKNOWN` の場合は確定リーサル加点を禁止する必要がある。
4. **投擲 (`action.throwing`) 回帰テストの不備 (P0):**
   - 手札に ♠10 のみを用意していたためキーカード条件（♠と♣）を満たさず、LegalPattern が生成されていないのに PASS と記録されていた。
5. **GitHub Actions CI 失敗の解消とAIバージョン分離 (P0):**
   - 過去のテスト（`gen9BehaviorQualityAudit.test.ts` BP-AI-13, `gen9BehaviorQualityAuditR2.test.ts` BP-AI-14）との後方互換性を保ち、過去の動作を改ざんせず保護するため、AIバージョンを厳密に分離する。

本Workでは上記の問題を完全修正し、スタンダード＋パックAIの完成判定を確定させた。

---

## 3. 実装内容詳細

### 3.1 非公開ライフの確定扱い完全禁止 (P0)
- `GenericTacticalEvaluator.evaluateProactiveAction()` において、`lifeDisplay` から数値をパースして確定値と見なすコードを完全撤廃。
- 自分の正確なライフ枚数と相手の公開可能ライフを厳格に区別：
  - `oppView.lifeCount` が数値（9枚以下）のときのみ `isCertainOppLife = true` として正確な枚数を扱う。
  - `oppView.lifeCount === undefined`（10枚以上）のときは `isCertainOppLife = false` とし、確定リーサル加点（`+2.5`）を禁止。
  - 非公開ライフ時は、通常の直接ダメージ加点（`dmg * 0.04`、最大 `+0.60`）のみを適用。

### 3.2 相手ライフトップへのカード移動の考慮 (P0)
- `GenericTacticalEvaluator` において、`moveUnitCardsToZoneTop` 等で相手ライフトップへ移動する兵士のカード枚数（複数カード構成の場合は `u.cards.length`、フォールバック `1`）を集計：
  ```ts
  const addedLifeCards = movedToLifeOppUnits.reduce((sum, u) => {
    const count = u.cards && u.cards.length > 0 ? u.cards.length : 1;
    return sum + count;
  }, 0);
  const effectiveOppLife = isCertainOppLife ? (oppView!.lifeCount! + addedLifeCards) : undefined;
  ```
- 有効相手ライフ `effectiveOppLife` に対して `directDamageToOpponent.min >= effectiveOppLife` を判定。
- テスト検証: 相手公開Life 9 + 5枚構成兵士 = 有効14枚に対し、13点ダメージ死の槍では 13 < 14 となり確定リーサルが正しく不成立となることを実証。

### 3.3 ガード条件確実性の厳格判定 (P0)
- 確定リーサル判定の前提条件として、`guardStatus === "CERTAIN_SATISFIED"` を厳格に要求。
- ガード条件が非公開情報に依存して `UNCERTAIN` または未知の式で `UNKNOWN` の場合は確定リーサル加点を禁止。
- ガード確定不発（`isGuardedOut`）の場合は戦術加点を `0` とし、無駄撃ちを回避。

### 3.4 投擲 (`action.throwing`) 回帰テストの完全修正 (P0)
- 公式 YAML（`throwing.yaml`）のキーカード条件（♠1枚＋♣1枚）に準拠し、手札に ♠10 と ♣A の2枚を用意。
- `expect(throwIdx).toBeGreaterThanOrEqual(0)` で合法手生成を厳格にアサート（生成されなければ FAIL）。
- `throwingPatternFound: false` を PASS として記録するコードを完全排除。
- 公開ライフ 8（確定致死: 10 >= 8 で `+2.5` 加点、投擲最高選択）と非公開ライフ 15（非致死直接ダメージ加点 `+0.40`）の両局面を検証。

### 3.5 AIバージョン分離と過去保護 (P0 CI失敗解消)
- `Gen9TacticalPrototypePolicy` および `Gen9LearnableTacticalPolicy` に `behaviorVersion: "legacy" | "improved"` を導入。
- 既存 Policy ID（`gen9-r4-v72`, `gen9-cost-preview-v73`）は `legacy` 動作としてそのまま保護。
- 改善版・完成版 AI を新しい Policy ID（`gen9-r4-v72b` および `gen9-cost-v73b`）として新設。
- 旧 Fixture の `size: 5` との後方互換性対応（`getUnitSize(u) = u.currentSize ?? (u as any).size ?? 0`）。
- これにより、過去の全テスト（`gen9BehaviorQualityAudit.test.ts` 21件、`gen9BehaviorQualityAuditR2.test.ts` 5件、`evolutionPlaytestIntegration.test.ts` 22件）および全251テストファイル（3,644テスト）が 100% PASS を達成。

---

## 4. 検証結果サマリー

### 4.1 新規・更新テスト結果 (`gen9FinalBehaviorImprovement.test.ts`)

全15テストすべて **PASS**。

| No | テスト項目 | 検証内容 | 判定 |
|:---|:---|:---|:---:|
| 1.1 | エース兵士正規生成 | rank: "A", value: 1 の正規トランプ表現確認 | **PASS** |
| 1.2 | Joker数値整合 | rank: "JOKER", value: 0 (20ではない) の整合確認 | **PASS** |
| 2.1 | BP-AI-14 犬死回避 (サイズ1) | 自軍サイズ1 vs 相手サイズ6: 完全犬死アタック回避、防壁セット選択 | **PASS** |
| 2.2 | 犬死回避 (サイズ2) | 自軍サイズ2 vs 相手サイズ6: 犬死アタック回避、防壁セット選択 | **PASS** |
| 2.3 | 空集合アタック回避 | アタッカー0体 (疲労): 空アタック回避、エンド選択 | **PASS** |
| 2.4 | 有効戦闘の正常許容 | 自軍サイズ6 vs 相手サイズ6 (相打ち): アタック加点 (+0.05) 維持 | **PASS** |
| 3.1 | BP-AI-09 公開ライフ8致死局面 | 相手公開Life 8 + 移動1枚 = 有効9枚に対し、死の槍 ♠K=13点で確定リーサル (+2.5) 発動 | **PASS** |
| 3.2 | BP-AI-09 非公開ライフ15局面 | 相手実Life 15 (非公開 10以上): 確定リーサルと誤認せず、除去+ダメージ (+0.87) で死の槍選択 | **PASS** |
| 3.3 | 複数カード移動による致死変化 | 相手公開Life 9 + 5枚構成兵士 = 有効14枚に対し、13点では確定リーサル不成立を実証 | **PASS** |
| 3.4 | BP-AI-09 ガード不発回避 | ♢3 vs サイズ10 (10 % 3 != 0): 戦術加点 0、無駄撃ち死の槍を回避し防壁選択 | **PASS** |
| 3.5 | ガード不確実時のリーサル禁止 | ガード条件が UNCERTAIN / UNKNOWN のとき確定リーサル (+2.5) を禁止することを実証 | **PASS** |
| 3.6 | 投擲汎用評価 (P0回帰テスト修正) | ♠10+♣A で投擲生成保証。公開Life8で確定リーサル (+2.5)、非公開Life15で通常加点 (+0.40) | **PASS** |
| 4.1 | AIバージョン分離 | 既存 Policy ID は legacy、新設 Policy ID は improved として独立保護 | **PASS** |
| 5.1 | 致死防御ブロック維持 | 相手サイズ10 vs 自軍Life8: PASSせず防御ブロック選択を維持 | **PASS** |
| 6.1 | ヘッドレス対戦完走 | Standard+Pack で gen9-r4-v72b vs gen9-cost-v73b の実対戦が正常に完走 | **PASS** |

### 4.2 全体テスト・ビルド・健全性検証結果

- **ビルド (`npm run build`):** 成功 (TSC型チェック & Vite本番ビルド通過)
- **全単体テスト (`npm test`):** 全251ファイル、3,644テスト **全件 PASS** (FAIL 0件)
- **コアフロープレイテスト (`npm run playable:check`):** **SUCCESS** (1戦通しの全コアフロー完走)
- **比較レポート (`npm run compare:rules-vnext`):** 正常生成
- **新YAMLシナリオランナー (`npm run scenario:rules-vnext`):** 8シナリオ **全件成功**
- **エビデンスファイル:** `tools/simulator/evidence/gen9_final_behavior_improvement_work57b.json`
- **エビデンスSHA-256:** `D39E1A04B46751E72A60D30C62BA02E92BA38F2E8F8221E6367BB5AE2BE4D568`

---

## 5. スタンダード＋パックAI 完成判定 (確定)

本Work 5-7B R1をもって、以下の完成判定を確定する。

1. **行動品質の合理的整合性:**
   - 明らかに不利な犬死アタックおよび空集合アタックが確実に排除された。
   - 非公開情報の遮断を厳格に維持しつつ、公開ライフ情報・ライフトップ移動・ガード条件の確実性に基づき、攻撃魔法を的確に発動・抑制できるようになった。
   - 投擲などの他アクションに対しても汎用DSL評価が正常に波及している。
2. **後方互換性と再現性の両立:**
   - 過去の Policy ID（`gen9-r4-v72`, `gen9-cost-preview-v73`）の動作はそのまま保護され、過去の検証エビデンスやテストを一切壊していない。
   - 完成版 AI（`gen9-r4-v72b`, `gen9-cost-v73b`）が Playtest UI から選択可能となった。
3. **Gen 9 開発の終了:**
   - **スタンダード＋パックAI（Gen 9）は、人間が自然に対戦できる合理的な戦術水準に到達したと判定し、これをもってGen 9の開発を完了とする。**
   - 今後の開発リソースはAIの追加育成ではなく、Playtest UIの操作性改善およびマスター＋エクストラレギュレーション開発へ移行する。

---

## 6. 次期プレイテストUI改善への引き継ぎ事項

1. **Policy 選択肢の最新化:**
   - `PlaytestSeatController.ts` において、`gen9-r4-v72b`（完成版戦術AI）および `gen9-cost-v73b`（完成版コスト評価AI）が選択肢に追加されている。
   - UIのドロップダウンで「Gen 9 R4 — 戦術AI (v7.2b 完成版)」をデフォルトまたは推奨として案内可能。
2. **UI操作性・演出の改善項目:**
   - ゲームログのスクロール追従性と視認性の向上。
   - 決定ドック（Decision Dock）におけるAI思考理由（`reasons`）のツールチップ・展開表示。
   - モバイル画面でのカード選択・ドラッグ操作の改善。
3. **マスター＋エクストラレギュレーション開発への移行:**
   - スタンダード＋パックのコアフローとAI動作が完全に安定したため、次期レギュレーション（マスター＋エクストラ）のYAML定義・カード実装・テスト整備へ安全に着手可能。
