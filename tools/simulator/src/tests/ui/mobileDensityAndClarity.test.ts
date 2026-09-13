import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { MatchSetupScreen } from "../../ui/playtest/MatchSetupScreen";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";
import { createSeatControllers, normalizeHumanSeatForMode } from "../../engine/playtest/PlaytestSeatController";
import { PlayerBoard } from "../../ui/game/PlayerBoard";
import { PlayerObservationPresenter } from "../../ui/game/PlayerObservationPresenter";
import { PlayerZoneStrip } from "../../ui/game/PlayerZoneStrip";
import { StagePanel } from "../../ui/game/StagePanel";
import { DecisionPanel, formatCostPaymentDisplay } from "../../ui/decision/DecisionPanel";
import { UnitCard } from "../../ui/game/UnitCard";
import { BattleRelationPresenter } from "../../ui/game/BattleRelationPresenter";
import { MobileHeaderMenu } from "../../ui/game/MobileHeaderMenu";
import { buildPlaytestShareUrl, PlaytestShareConfigV1 } from "../../ui/playtest/PlaytestShareUrl";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";

describe("UI Phase 3.3: Mobile Density & Board Clarity Tests", () => {
  // 改善1: Human vs AI の先攻後攻を手動選択させない & Human=p1 正規化
  describe("改善1: Human vs AI の先攻後攻自動決定とHuman=p1正規化", () => {
    it("1.1: MatchSetupScreen で humanVsAi の場合、Human 席選択 UI が存在せず、自動決定の案内文が表示される", () => {
      const html = renderToString(
        React.createElement(MatchSetupScreen, {
          environmentOptions: [
            {
              id: "core-battle-playtest",
              name: "Core Battle Playtest",
              isOfficial: false,
            },
          ],
          selectedEnvironmentId: "core-battle-playtest",
          onSelectEnvironment: () => {},
          matchMode: "humanVsAi",
          onSelectMatchMode: () => {},
          humanSeat: "p1",
          onSelectHumanSeat: () => {},
          policyId: "firstLegal",
          onSelectPolicyId: () => {},
          seedInput: "",
          onSeedInputChange: () => {},
          onStartMatch: () => {},
          onOpenReplayVerify: () => {},
        })
      );

      // Human 席選択セレクトボックスが存在しない
      expect(html).not.toContain("data-testid=\"setup-human-seat\"");
      expect(html).not.toContain("あなた（操作側）の席");

      // 自動決定案内が表示される
      expect(html).toContain("※先攻・後攻は対戦開始時に各プレイヤーのライフのトップカード比較により自動決定されます。");
    });

    it("1.2: MatchSetupScreen で humanVsHuman の場合は自動決定案内は非表示", () => {
      const html = renderToString(
        React.createElement(MatchSetupScreen, {
          environmentOptions: [
            {
              id: "core-battle-playtest",
              name: "Core Battle Playtest",
              isOfficial: false,
            },
          ],
          selectedEnvironmentId: "core-battle-playtest",
          onSelectEnvironment: () => {},
          matchMode: "humanVsHuman",
          onSelectMatchMode: () => {},
          humanSeat: "p1",
          onSelectHumanSeat: () => {},
          policyId: "firstLegal",
          onSelectPolicyId: () => {},
          seedInput: "",
          onSeedInputChange: () => {},
          onStartMatch: () => {},
          onOpenReplayVerify: () => {},
        })
      );

      expect(html).not.toContain("※先攻・後攻は対戦開始時に各プレイヤーのライフのトップカード比較により自動決定されます。");
    });

    it("1.3: Core Setup 契約: ライフトップ比較による先攻決定 (8 vs 5 -> p1, 3 vs 9 -> p2)", () => {
      // ケースA: p1 (H8) vs p2 (S5) -> p1 が先攻
      const mockStateA = {
        players: {
          p1: {
            life: [
              { suit: "H", rank: "8", value: 8 },
              { suit: "S", rank: "A", value: 1 },
              { suit: "C", rank: "K", value: 13 },
            ],
            field: [],
            hand: [],
            grave: [],
          },
          p2: {
            life: [
              { suit: "S", rank: "5", value: 5 },
              { suit: "D", rank: "2", value: 2 },
              { suit: "H", rank: "4", value: 4 },
            ],
            field: [],
            hand: [],
            grave: [],
          },
        },
      };

      const resultA = MatchSetupCoordinator.setupMatch(mockStateA);
      expect(resultA.firstPlayer).toBe("p1");
      expect(resultA.state.turnPlayer).toBe("p1");
      expect(resultA.state.chancePlayer).toBe("p1");
      // 3枚のライフから: 1枚を先攻比較で消費(墓地へ)、先攻 p1 はさらに1枚ドロー(手札へ) -> 残ライフ1, 手札1, 墓地1
      expect(resultA.state.players.p1.life.length).toBe(1);
      expect(resultA.state.players.p1.hand.length).toBe(1);
      expect(resultA.state.players.p1.grave.length).toBe(1);
      // 後攻 p2 は1枚を先攻比較で消費(墓地へ)、ドローはしない -> 残ライフ2, 手札0, 墓地1
      expect(resultA.state.players.p2.life.length).toBe(2);
      expect(resultA.state.players.p2.hand.length).toBe(0);
      expect(resultA.state.players.p2.grave.length).toBe(1);

      // ケースB: p1 (C3) vs p2 (D9) -> p2 が先攻
      const mockStateB = {
        players: {
          p1: {
            life: [
              { suit: "C", rank: "3", value: 3 },
              { suit: "S", rank: "A", value: 1 },
              { suit: "H", rank: "2", value: 2 },
            ],
            field: [],
            hand: [],
            grave: [],
          },
          p2: {
            life: [
              { suit: "D", rank: "9", value: 9 },
              { suit: "H", rank: "7", value: 7 },
              { suit: "C", rank: "K", value: 13 },
            ],
            field: [],
            hand: [],
            grave: [],
          },
        },
      };

      const resultB = MatchSetupCoordinator.setupMatch(mockStateB);
      expect(resultB.firstPlayer).toBe("p2");
      expect(resultB.state.turnPlayer).toBe("p2");
      expect(resultB.state.chancePlayer).toBe("p2");
      // 先攻 p2 は1枚比較消費 + 1枚ドロー -> 残ライフ1, 手札1, 墓地1
      expect(resultB.state.players.p2.life.length).toBe(1);
      expect(resultB.state.players.p2.hand.length).toBe(1);
      expect(resultB.state.players.p2.grave.length).toBe(1);
      // 後攻 p1 は1枚比較消費 -> 残ライフ2, 手札0, 墓地1
      expect(resultB.state.players.p1.life.length).toBe(2);
      expect(resultB.state.players.p1.hand.length).toBe(0);
      expect(resultB.state.players.p1.grave.length).toBe(1);
    });

    it("1.4: Human vs AI の内部設定正規化: 渡された seat が p2 でも createSeatControllers への内部解決は p1 とする", () => {
      // 復元やURL共有などで humanSeat: "p2" が指定された場合でも、
      // CoreBattlePlaytest では mode === "humanVsAi" の時 resolvedHumanSeat = "p1" へ正規化する契約
      const mode = "humanVsAi";
      const pendingSeat = "p2" as const;
      const normalizedSeat = normalizeHumanSeatForMode(mode, pendingSeat);
      const seatControllers = createSeatControllers(mode, normalizedSeat, "firstLegal");

      expect(seatControllers.p1.kind).toBe("HUMAN");
      expect(seatControllers.p2.kind).toBe("POLICY");

      // humanVsHuman では正規化せずそのまま
      const hvhControllers = createSeatControllers("humanVsHuman", "p2");
      expect(hvhControllers.p1.kind).toBe("HUMAN");
      expect(hvhControllers.p2.kind).toBe("HUMAN");
    });
  });

  // 改善2: 兵士列も右寄せ
  describe("改善2: 兵士列の右寄せ表示 (justify-end)", () => {
    it("2.1: PlayerBoard の soldierRow が top / bottom ともに justify-end クラスを持つ", () => {
      const mockPlayer = {
        playerId: "p1",
        name: "Player A",
        isViewer: true,
        lifeDisplay: "15",
        handCount: 3,
        handCards: [],
        field: [
          {
            unitId: "u-soldier-1",
            kind: "一般兵",
            state: "charge",
            face: "up",
            cards: [{ suit: "S", rank: "6", value: 6 }],
          },
          {
            unitId: "u-soldier-2",
            kind: "一般兵",
            state: "charge",
            face: "up",
            cards: [{ suit: "H", rank: "4", value: 4 }],
          },
        ],
        fog: [],
        trumps: [],
        graveCount: 0,
        grave: [],
        canViewFullGrave: true,
      };

      const mockObservation = {
        viewerPlayerId: "p1" as const,
        players: [mockPlayer],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      };
      const vmBottom = PlayerObservationPresenter.buildPlayerViewModel("p1", mockObservation as any, undefined, "p1");

      // Bottom (操作側)
      const htmlBottom = renderToString(
        React.createElement(PlayerBoard, {
          playerKey: "p1",
          viewModel: vmBottom,
          position: "bottom",
        })
      );

      // soldierRow のコンテナに justify-end が含まれる
      expect(htmlBottom).toContain("justify-end");
      expect(htmlBottom).toContain("兵士 (2体)");

      // Top (相手側)
      const htmlTop = renderToString(
        React.createElement(PlayerBoard, {
          playerKey: "p1",
          viewModel: vmBottom,
          position: "top",
        })
      );
      expect(htmlTop).toContain("justify-end");
    });

    it("2.2: 兵士列の配列順序が維持されていること（反転せず 0, 1 の順で描画）", () => {
      const mockPlayer = {
        playerId: "p1",
        name: "Player A",
        isViewer: true,
        lifeDisplay: "15",
        handCount: 0,
        handCards: [],
        field: [
          {
            unitId: "u-first",
            kind: "一般兵",
            state: "charge",
            face: "up",
            cards: [{ suit: "S", rank: "6", value: 6 }],
          },
          {
            unitId: "u-second",
            kind: "一般兵",
            state: "charge",
            face: "up",
            cards: [{ suit: "H", rank: "4", value: 4 }],
          },
        ],
        fog: [],
        trumps: [],
        graveCount: 0,
        grave: [],
        canViewFullGrave: true,
      };

      const mockObservation = {
        viewerPlayerId: "p1" as const,
        players: [mockPlayer],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      };
      const vm = PlayerObservationPresenter.buildPlayerViewModel("p1", mockObservation as any, undefined, "p1");

      const html = renderToString(
        React.createElement(PlayerBoard, {
          playerKey: "p1",
          viewModel: vm,
          position: "bottom",
        })
      );

      // DOM 内で u-first が u-second より先に出現する（配列順序が維持されている）
      const idxFirst = html.indexOf("Debug ID: u-first");
      const idxSecond = html.indexOf("Debug ID: u-second");
      expect(idxFirst).toBeGreaterThan(-1);
      expect(idxSecond).toBeGreaterThan(-1);
      expect(idxFirst).toBeLessThan(idxSecond);
    });
  });

  // 改善3: スマホ表示の余白削減
  describe("改善3: レスポンシブ余白圧縮クラスの適用確認", () => {
    it("3.1: PlayerBoard, PlayerZoneStrip, StagePanel, DecisionPanel に sm: プレフィックス付きレスポンシブパディングが存在する", () => {
      // PlayerZoneStrip
      const stripHtml = renderToString(
        React.createElement(PlayerZoneStrip, {
          items: [{ id: "test", label: "TEST", count: 1 }],
        })
      );
      expect(stripHtml).toContain("py-0.5 sm:py-1");

      // StagePanel
      const stageHtml = renderToString(
        React.createElement(StagePanel, {
          requests: [],
        })
      );
      expect(stageHtml).toContain("p-1.5 sm:p-2");
      expect(stageHtml).toContain("pb-1 sm:pb-1.5");
    });
  });

  // 改善4: 防壁番号の分かりづらさ解消
  describe("改善4: 防壁番号の視認性向上 (B①, B② を主たる識別子として強調)", () => {
    const bulwarkUnit = {
      unitId: "bw-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "charge",
      face: "up",
      cards: [{ suit: "S", rank: "2", value: 2, faceUp: true }],
    };

    const bulwarkDisplayInfo = {
      unitId: "bw-1",
      badge: "②", // Target relation 番号
      label: "② ♠2 防壁",
      bulwarkPosition: "①", // ライフ側から ①
      ownerPlayerKey: "p1",
      blockedByBadges: [],
    };

    it("4.1: UnitCard で防壁の主識別子として B① が強調表示され、Target 番号 ② と分離されている", () => {
      const html = renderToString(
        React.createElement(UnitCard, {
          unit: bulwarkUnit,
          battleDisplayInfo: bulwarkDisplayInfo,
          showCardDetails: true,
        })
      );

      // B① が存在し、防壁の主たる位置識別子として描画される
      expect(html).toContain("B①");
      expect(html).toContain("防壁配置: ライフ側から ①");
      // Target 番号 ② も secondary として存在
      expect(html).toContain("②");
      expect(html).toContain("title=\"Target番号\"");
    });

    it("4.2: Bコスト支払いUIの '防壁① ♠2' と盤面の 'B①' が1対1で整合する", () => {
      const mockRequest: any = {
        playerId: "p1",
        observation: {
          players: [
            {
              playerId: "p1",
              field: [bulwarkUnit],
            },
          ],
        },
      };

      const battleMap = new Map([["bw-1", bulwarkDisplayInfo]]);
      const costSel = {
        drivenBulwarkUnitIds: ["bw-1"],
      };

      const costLabel = formatCostPaymentDisplay(costSel, mockRequest, battleMap);
      expect(costLabel).toBe("防壁① ♠2");
      // UnitCard の B① と完全に一致
      expect(costLabel).toContain(`防壁${bulwarkDisplayInfo.bulwarkPosition}`);
    });
  });

  // 改善5: モバイル時の場カードを簡易表示
  describe("改善5: モバイル時の場カード要約表示 & 秘密情報保護", () => {
    const soldierUnit = {
      unitId: "u-soldier-1",
      kind: "一般兵",
      state: "charge",
      face: "up",
      cards: [
        { suit: "S", rank: "6", value: 6, faceUp: true },
        { suit: "H", rank: "4", value: 4, faceUp: true },
      ],
    };

    const soldierDisplayInfo = {
      unitId: "u-soldier-1",
      badge: "①",
      label: "① ♠6 一般兵",
      ownerPlayerKey: "p1",
      blockedByBadges: [],
    };

    it("5.1: モバイル要約表示 (sm:hidden) と デスクトップ表示 (hidden sm:flex) の両方が描画される", () => {
      const html = renderToString(
        React.createElement(UnitCard, {
          unit: soldierUnit,
          battleDisplayInfo: soldierDisplayInfo,
          showCardDetails: true,
        })
      );

      expect(html).toContain("flex sm:hidden");
      expect(html).toContain("hidden sm:flex");
    });

    it("5.2: モバイル要約表示にスート+数字 (♠6), 種別, 状態 (C/D), SIZE が含まれる", () => {
      const html = renderToString(
        React.createElement(UnitCard, {
          unit: soldierUnit,
          battleDisplayInfo: soldierDisplayInfo,
          showCardDetails: true,
        })
      );

      // モバイル要約部分の検査
      expect(html).toContain("♠6");
      expect(html).toContain("一般兵");
      expect(html).toContain("S:"); // SIZE プレフィックス
      expect(html).toContain("10"); // SIZE 合計 6+4=10
      expect(html).toContain(">C<"); // CHARGE 状態
      expect(html).toContain("+1"); // 追加カード枚数
    });

    it("5.3: 相手の非公開防壁の秘密情報がモバイル要約表示で漏洩しない (🂠 および ? 表示)", () => {
      const opponentHiddenBulwark = {
        unitId: "bw-opp-hidden",
        kind: "防壁",
        componentId: "character.bulwark",
        state: "charge",
        face: "down",
        cards: [{ visibility: "HIDDEN", id: "c-hidden-1" }],
      };

      const oppBulwarkInfo = {
        unitId: "bw-opp-hidden",
        badge: "①",
        label: "① 防壁",
        bulwarkPosition: "①",
        ownerPlayerKey: "p2",
        blockedByBadges: [],
      };

      const html = renderToString(
        React.createElement(UnitCard, {
          unit: opponentHiddenBulwark,
          battleDisplayInfo: oppBulwarkInfo,
          showCardDetails: false, // 相手視点
        })
      );

      // カードバック 🂠 が表示され、スートや数字は一切漏洩しない
      expect(html).toContain("🂠");
      expect(html).toContain("?");
      // 存在しないスートやランク
      expect(html).not.toContain("♠");
      expect(html).not.toContain("♡");
      expect(html).not.toContain("♢");
      expect(html).not.toContain("♣");
    });

    it("5.4: 自分自身の伏せ防壁は本人にはカードスート・数字・防壁数字が見える", () => {
      const ownBulwark = {
        unitId: "bw-own-1",
        kind: "防壁",
        componentId: "character.bulwark",
        state: "charge",
        face: "down",
        cards: [{ suit: "D", rank: "7", value: 7, faceUp: false }],
      };

      const ownBulwarkInfo = {
        unitId: "bw-own-1",
        badge: "①",
        label: "① ♢7 防壁",
        bulwarkPosition: "①",
        ownerPlayerKey: "p1",
        blockedByBadges: [],
      };

      const html = renderToString(
        React.createElement(UnitCard, {
          unit: ownBulwark,
          battleDisplayInfo: ownBulwarkInfo,
          showCardDetails: true, // 自分視点
        })
      );

      // ♢7 が表示される
      expect(html).toContain("♢7");
      expect(html).toContain("数:");
      expect(html).toContain("7");
    });
  });

  // UI Phase 3.3-R1: MobileHeaderMenu Human Seat 削除とモード切替正規化
  describe("UI Phase 3.3-R1: MobileHeaderMenu Human Seat 削除とモード切替正規化", () => {
    it("R1.1: normalizeHumanSeatForMode 純粋関数が期待通りに動作すること", () => {
      expect(normalizeHumanSeatForMode("humanVsAi", "p2")).toBe("p1");
      expect(normalizeHumanSeatForMode("humanVsAi", "p1")).toBe("p1");
      expect(normalizeHumanSeatForMode("humanVsHuman", "p2")).toBe("p2");
      expect(normalizeHumanSeatForMode("humanVsHuman", "p1")).toBe("p1");
    });

    it("R1.2: MobileHeaderMenu で humanVsAi の場合、Human Seat 選択 UI が完全撤廃され、自動決定案内が表示されること", () => {
      const html = renderToString(
        React.createElement(MobileHeaderMenu, {
          isOpen: true,
          onClose: () => {},
          selectedEnvironmentId: "core-battle-playtest",
          onSelectEnvironment: () => {},
          environmentOptions: [
            { id: "core-battle-playtest", name: "Core Battle Playtest", isOfficial: false },
          ],
          showSeedInput: false,
          matchMode: "humanVsAi",
          onSelectMatchMode: () => {},
          policyId: "firstLegal",
          onSelectPolicyId: () => {},
          isOfficialEnvironment: false,
          enablePassAndPlay: false,
          onTogglePassAndPlay: () => {},
          onOpenLogModal: () => {},
          onOpenDebugModal: () => {},
          onResetGame: () => {},
        })
      );

      // プレイヤー席 / Human Seat 関連の文言や option が一切描画されない
      expect(html).not.toContain("プレイヤー席");
      expect(html).not.toContain("Human Seat");
      expect(html).not.toContain("Player A (p1)");
      expect(html).not.toContain("Player B (p2)");

      // 自動決定案内が表示される
      expect(html).toContain("※先攻・後攻は対戦開始時に各プレイヤーのライフのトップカード比較により自動決定されます。");

      // AI Policy 選択と実在する4つのポリシーが表示される
      expect(html).toContain("AI Policy:");
      expect(html).toContain("FirstLegal (Baseline)");
      expect(html).toContain("SeededRandom (Baseline)");
      expect(html).toContain("ManualGenericGenome (Experimental)");
      expect(html).toContain("ZeroGenome (Debug)");
    });

    it("R1.3: MobileHeaderMenu で humanVsHuman の場合、自動決定案内も AI Policy も表示されないこと", () => {
      const html = renderToString(
        React.createElement(MobileHeaderMenu, {
          isOpen: true,
          onClose: () => {},
          selectedEnvironmentId: "core-battle-playtest",
          onSelectEnvironment: () => {},
          environmentOptions: [
            { id: "core-battle-playtest", name: "Core Battle Playtest", isOfficial: false },
          ],
          showSeedInput: false,
          matchMode: "humanVsHuman",
          onSelectMatchMode: () => {},
          policyId: "firstLegal",
          onSelectPolicyId: () => {},
          isOfficialEnvironment: false,
          enablePassAndPlay: false,
          onTogglePassAndPlay: () => {},
          onOpenLogModal: () => {},
          onOpenDebugModal: () => {},
          onResetGame: () => {},
        })
      );

      expect(html).not.toContain("※先攻・後攻は対戦開始時に各プレイヤーのライフのトップカード比較により自動決定されます。");
      expect(html).not.toContain("AI Policy:");
      expect(html).not.toContain("プレイヤー席");
      expect(html).not.toContain("Human Seat");
    });

    it("R1.4: 共有 URL 生成時、humanVsAi の場合は humanSeat が p1 に正規化され human=p2 が混入しないこと", () => {
      const catalog = loadRegulationCatalogForBrowser();
      const currentUrl = "http://localhost:5173/";

      // pendingHumanSeat が万一 "p2" の状態で humanVsAi を共有した場合
      const pendingHumanSeat = "p2" as const;
      const configAi: PlaytestShareConfigV1 = {
        version: 1,
        environmentId: "official:light-entry16",
        mode: "humanVsAi",
        humanSeat: normalizeHumanSeatForMode("humanVsAi", pendingHumanSeat),
        policyId: "firstLegal",
        seedInput: "42",
      };

      const urlAi = buildPlaytestShareUrl(currentUrl, configAi, catalog);
      expect(urlAi).toContain("human=p1");
      expect(urlAi).not.toContain("human=p2");

      // humanVsHuman の場合は human パラメータ自体が除外される (canonicalization 契約)
      const configHvh: PlaytestShareConfigV1 = {
        version: 1,
        environmentId: "official:light-entry16",
        mode: "humanVsHuman",
        humanSeat: normalizeHumanSeatForMode("humanVsHuman", "p2"),
        policyId: "firstLegal",
        seedInput: "42",
      };
      const urlHvh = buildPlaytestShareUrl(currentUrl, configHvh, catalog);
      expect(urlHvh).not.toContain("human=");
    });
  });
});

