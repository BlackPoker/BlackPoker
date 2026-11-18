# BlackPoker Playtest レスポンシブUI再設計 — Phase 2（Phase 2A / 2B）実装・7解像度実測レポート

**Work ID:** `BP-SIM-PLAYTEST-RESPONSIVE-UI-PHASE2-EVIDENCE`  
**対象ブランチ:** `BlackPoker/issue551-core-flow`  
**Phase 2 開始基準Commit:** `93602cc52b1755526a136b0ba24fba032dda964c`  
**Phase 2A Commit:** `cfe304da7`

---

## 1. Phase 2A / Phase 2B の実装内容

### 1.1 Phase 2A：盤面高さ・配置の改善 (`cfe304da7`)
1. **`PlayerBoard` のヘッダーと `PlayerZoneStrip` の1行統合 ([`PlayerBoard.tsx`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/ui/game/PlayerBoard.tsx), [`PlayerZoneStrip.tsx`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/ui/game/PlayerZoneStrip.tsx))**
   - 従来2段に分かれていたプレイヤーサマリー行（`Player A/B`, `TURN`, `CHANCE`, `FOCUS`）とゾーン情報行（`FOG`, `墓地 / TOP`, `PACK`, `RARE`）を1本のヘッダーバー（`data-testid="player-board-header"`）へ統合し、上下2プレイヤー分で `64px` の高さを削減。
2. **兵士列・防壁列の縦方向配置の維持とラベル省スペース化 ([`PlayerBoard.tsx`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/ui/game/PlayerBoard.tsx))**
   - 実カード配置との視覚的一致を厳守し、Topプレイヤー（奥側）は **`上＝防壁列、下＝兵士列`**、Bottomプレイヤー（手前側）は **`上＝兵士列、下＝防壁列`** の別列配置を維持。
   - `兵士 (N体)` / `防壁 (N体・ライフ側 →)` のラベルを各列枠内の右上インラインオーバーレイ（`lg:absolute lg:top-0.5 lg:right-2`）に収め、外出しラベル行による高さを削減。
3. **相手手札表示のコンパクト化と秘密情報保護 ([`PlayerBoard.tsx`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/ui/game/PlayerBoard.tsx))**
   - 操作側（`isViewer === true`）のみカード表面（`HAND` セクション）を描画し、非操作側（相手側）は統合ヘッダー内の `HAND: N` カウントバッジのみを表示して高さを削減するとともに、秘密情報を厳格に保護。
4. **`DRIVE` カードの回転時レイアウト改善 ([`UnitCard.tsx`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/ui/game/UnitCard.tsx))**
   - `my-3` の単純削除ではなく、カード描画スロット（`data-testid="unit-card-visual-slot"`）を `w-[56px] min-h-[50px]`（実測 `56px × 52px`）の共通固定ボックスとして設計し、`isDrive` 時は `rotate-90 scale-90 my-0` でスロット中心回転させることで、CHARGE時（`100.1px × 104.5px`）とDRIVE時でユニットカードの高さを完全一致させ、上下バッジや隣接カードとの重なり・クリック領域のズレを解消。
5. **`STAGE` (`StagePanel`) と `GameStatusBar` のコンパクト化 ([`StagePanel.tsx`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/ui/game/StagePanel.tsx), [`GameStatusBar.tsx`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/ui/game/GameStatusBar.tsx))**
   - 空ステージ時はデスクトップで1行スリム表示（高さ `36px`）に圧縮し、リクエスト積載時は `max-h-28 xl:max-h-36 overflow-y-auto` で独立スクロール化。
   - `GameStatusBar` のバージョン表記（`v2 | Action Request or PASS`）を `EVENT` 行右端に統合し、`1440×900` や `1366×768` でのステータスバー2段折り返し（`+22.5px` 膨張）を解消。

### 1.2 Phase 2B：デスクトップ2ペインのスクロールと操作領域改善
1. **ページ全体スクロールの抑制と `1920px` 横幅有効活用 ([`CoreBattlePlaytest.tsx`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/ui/playtest/CoreBattlePlaytest.tsx))**
   - 対戦中のルートコンテナに `lg:h-screen lg:overflow-hidden` を適用し、メインコンテナの最大幅を `max-w-[1440px]` から `max-w-[1840px]` へ拡張。
   - 左ペイン（`data-testid="playtest-left-pane"`, `lg:col-span-7`）と右ペイン（`data-testid="playtest-right-pane"`, `lg:col-span-5`）にそれぞれ `lg:h-full lg:min-h-0 lg:overflow-y-auto` を設定し、左右独立スクロールを実現。
2. **`DecisionPanel` の内部スクロールと決定・PASS・戻るボタンの常時固定 ([`DecisionPanel.tsx`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/ui/decision/DecisionPanel.tsx))**
   - パネル上部ヘッダー（`data-testid="decision-panel-header"`: `1つ戻る` / `PASS [P]`）と下部フッター（`data-testid="decision-panel-sticky-footer"`: `リクエストのみ` / `リクエスト＆PASS (推奨)` / `決定して解決する`）を `shrink-0` で固定。
   - 中央の選択肢領域（`data-testid="decision-panel-scroll-body"`）のみを `flex-1 min-h-0 overflow-y-auto lg:max-h-[46vh]` で独立スクロール可能にし、選択肢が多い場合でもスクロールなしで決定・PASS・Undoを即座に実行可能に改善。
3. **`GameLog` と `DebugPanel` のタブ化 ([`CoreBattlePlaytest.tsx`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/ui/playtest/CoreBattlePlaytest.tsx))**
   - 右ペイン下部にタブコンテナ（`data-testid="desktop-log-debug-container"`）を新設し、`📜 対戦ログ (N)` タブ（`desktop-tab-log`）と `🛠️ デバッグ (Debug)` タブ（`desktop-tab-debug`）でワンクリック切替可能に改善。Debug ON 時に右ペインが縦に溢れる問題を解消。

---

## 2. 実際のブラウザーによる7解像度 DOM 実測結果（Before / After 比較）

検証環境：`core-battle`（プリセット `CORE-BATTLE-001`：Player B 防壁1体＋兵士2体、STAGE、Player A 兵士2体＋防壁1体＋手札4枚の **4列フル展開状態**、および `DecisionPanel` で「アタック」選択時）。

| 解像度 | ページ全体スクロール (`scrollHeight - clientHeight`) | ヘッダー (`w × h` / 見切れ) | 左ペイン総コンテンツ高 (`Before -> After`) | 左ペイン内スクロール量 (`4列フル展開時`) | 右ペイン (`DecisionPanel` + `Log/Debug` タブ) | 兵士・防壁の並び順 (Top: 防壁→兵士 / Bottom: 兵士→防壁) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`1920×1080`** | **`0px`** (`1080 / 1080`) | `1920×48px`<br>見切れなし (`0px`) | `1,200px` → **`826px`**<br>(**`-374px` 削減**) | **`0px`**<br>(枠高 `1,016px` に対し `190px` 余裕で全収容) | `DecisionPanel`: `542px`<br>`Log/Debug`: `468px`<br>見切れ・ペインスクロール **`0px`** | `Top`: `y=178.5 < 308.5` (OK)<br>`Bottom`: `y=543.5 < 672` (OK) |
| **`1440×900`** | **`0px`** (`900 / 900`) | `1440×48px`<br>見切れなし (`0px`) | `1,200px` → **`826px`**<br>(**`-374px` 削減**) | **`0px`**<br>(枠高 `836px` 内に4列＋手札まで全収容) | `DecisionPanel`: `542px`<br>`Log/Debug`: `288px`<br>見切れ・ペインスクロール **`0px`** | `Top`: `y=178.5 < 308.5` (OK)<br>`Bottom`: `y=543.5 < 672` (OK) |
| **`1366×768`** | **`0px`** (`768 / 768`) | `1366×48px`<br>見切れなし (`0px`) | `1,200px` → **`826px`**<br>(**`-374px` 削減**) | **`122px`** (左ペインのみ独立スクロール。3列時は `0px`) | `DecisionPanel`: `501.3px`<br>`Log/Debug`: `196.7px`<br>見切れ・ペインスクロール **`0px`** | `Top`: `y=178.5 < 308.5` (OK)<br>`Bottom`: `y=543.5 < 672` (OK) |
| **`1024×768`** | **`0px`** (`768 / 768`) | `1024×48px`<br>見切れなし (`0px`) | `1,236px` → **`852px`**<br>(**`-384px` 削減**) | **`148px`** (左ペインのみ独立スクロール) | `DecisionPanel`: `520.8px`<br>`Log/Debug`: `177.2px`<br>見切れ・ペインスクロール **`0px`** | `Top`: `y=204.5 < 334.5` (OK)<br>`Bottom`: `y=569.5 < 698` (OK) |
| **`820×1180`** | **`0px`** (`1180 / 1180`) | `820×48px`<br>見切れなし (`0px`) | `720px` → **`532px`**<br>(**`-188px` 削減**) | **`0px`** (枠高 `1,032px` 内に余裕で全収容) | 下部固定 Dock + Bottom Sheet (見切れなし) | `Top`: `OK`<br>`Bottom`: `OK` |
| **`390×844`** | **`0px`** (`844 / 844`) | `390×57px`<br>見切れなし (`0px`) | `680px` → **`606.8px`**<br>(**`-73.2px` 削減**) | **`0px`** (枠高 `687px` 内に全収容) | 下部固定 Dock + Bottom Sheet (見切れなし) | `Top`: `OK`<br>`Bottom`: `OK` |
| **`360×800`** | **`0px`** (`800 / 800`) | `360×57px`<br>見切れなし (`0px`) | `680px` → **`606.8px`**<br>(**`-73.2px` 削減**) | **`0px`** (枠高 `643px` 内に全収容) | 下部固定 Dock + Bottom Sheet (見切れなし) | `Top`: `OK`<br>`Bottom`: `OK` |

---

## 3. DRIVE回転時のカード寸法・重なり・クリック領域の検証結果

- デスクトップ表示（`1920×1080`, `1440×900`, `1366×768`, `1024×768`）において、全6体のユニットカード内のビジュアルスロット（`data-testid="unit-card-visual-slot"`）を `getBoundingClientRect()` で計測した結果：
  - 全6スロットすべてが **`幅 56px × 高さ 52px`** で完全一致。
  - 親 `UnitCard` の外枠寸法は防壁が `108.7px × 106px`、兵士が `100.1px × 104.5px` で、隣接カード間には `6px`（`gap-1.5`）の明確な間隔が保たれ、**重なり（Overlap）は0件**。
  - `UnitCard` のクリックハンドラおよび選択マーカー（`①`, `②`）のクリック領域が回転後も100%外枠内に収まっていることをユニットテスト（[`playtestBoardPhase2A.test.tsx`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/src/tests/ui/playtestBoardPhase2A.test.tsx)）および実ブラウザーで確認。

---

## 4. テスト・ビルド・Playable 検証結果

- **UI テストスイート:** `53 passed (53)` / `629 passed (629)`（新規追加 `playtestBoardPhase2A.test.tsx` 5件、`playtestDesktopPanePhase2B.test.tsx` 3件を含む）
- **禁止キーワード監査 (`scenarioPhaseAudit.test.ts`):** `1 passed (1)`
- **プロダクションビルド (`npm run build`):** `tsc && vite build` 成功（エラー0件）
- **コアバトル完走チェック (`npm run playable:check`):** Turn 1〜Turn 3 決着まで全フロー完走成功
