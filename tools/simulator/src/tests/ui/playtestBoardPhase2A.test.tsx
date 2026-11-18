import React from "react";
import { renderToString } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi } from "vitest";
import { PlayerBoard } from "../../ui/game/PlayerBoard";
import { PlayerZoneStrip } from "../../ui/game/PlayerZoneStrip";
import { UnitCard } from "../../ui/game/UnitCard";
import { StagePanel } from "../../ui/game/StagePanel";
import type { PlayerBoardViewModel } from "../../ui/game/PlayerObservationPresenter";

describe("Playtest UI Redesign Phase 2A: Board Height Compression, Header Integration & DRIVE Layout", () => {
  const sampleUnits: any[] = [
    {
      unitId: "u-soldier-charge",
      kind: "兵士",
      state: "charge",
      face: "up",
      currentSize: 7,
      cards: [{ id: "c1", code: "S7", suit: "S", rank: 7, value: 7 }],
    },
    {
      unitId: "u-soldier-drive",
      kind: "兵士",
      state: "drive",
      face: "up",
      currentSize: 9,
      cards: [
        { id: "c2", code: "H4", suit: "H", rank: 4, value: 4 },
        { id: "c3", code: "D5", suit: "D", rank: 5, value: 5 },
      ],
    },
    {
      unitId: "u-bulwark-1",
      componentId: "character.bulwark",
      kind: "防壁",
      state: "charge",
      face: "down",
      cards: [{ id: "c4", code: "C3", suit: "C", rank: 3, value: 3 }],
    },
  ];

  const createViewModel = (overrides: Partial<PlayerBoardViewModel>): PlayerBoardViewModel => ({
    playerKey: "p1",
    name: "Player A",
    isViewer: true,
    isTurnPlayer: true,
    isChancePlayer: true,
    isFocusPlayer: true,
    lifeDisplay: "15",
    handCount: 5,
    handCards: [{ id: "h1", code: "S1", suit: "S", rank: 1, value: 1 }],
    fieldUnits: sampleUnits,
    graveCount: 2,
    graveCards: [{ id: "g1", code: "D2", suit: "D", rank: 2, value: 2 }],
    graveTopCard: { id: "g1", code: "D2", suit: "D", rank: 2, value: 2 },
    canViewFullGrave: true,
    fog: [],
    pack: { count: 5, opened: false, canViewCards: false, cards: [] },
    ...overrides,
  });

  it("1. PlayerBoardのヘッダーとPlayerZoneStripが1つの統合ヘッダーバー内に収まっていること", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <PlayerBoard
          playerKey="p1"
          viewModel={createViewModel({})}
          position="bottom"
        />
      );
    });

    const headerBar = renderer.root.findByProps({ "data-testid": "player-board-header" });
    expect(headerBar).toBeDefined();

    // ヘッダーバーの内部に PlayerZoneStrip が統合されていること
    const zoneStripInHeader = headerBar.findByType(PlayerZoneStrip);
    expect(zoneStripInHeader).toBeDefined();
    expect(zoneStripInHeader.props.items.length).toBeGreaterThanOrEqual(2);
  });

  it("2. 兵士列と防壁列が別々の列を維持し、Topプレイヤーは『上＝防壁、下＝兵士』、Bottomプレイヤーは『上＝兵士、下＝防壁』の正しい並び方向であること", () => {
    const topHtml = renderToString(
      <PlayerBoard
        playerKey="p2"
        viewModel={createViewModel({
          playerKey: "p2",
          name: "Player B",
          isViewer: false,
          isTurnPlayer: false,
          isChancePlayer: false,
          isFocusPlayer: false,
          lifeDisplay: "10以上",
          handCount: 4,
          handCards: [],
        })}
        position="top"
      />
    );

    const bottomHtml = renderToString(
      <PlayerBoard
        playerKey="p1"
        viewModel={createViewModel({})}
        position="bottom"
      />
    );

    // Top Player: 防壁列が先、兵士列が後
    const topBulwarkIdx = topHtml.indexOf('data-testid="player-board-bulwark-row"');
    const topSoldierIdx = topHtml.indexOf('data-testid="player-board-soldier-row"');
    expect(topBulwarkIdx).toBeGreaterThan(-1);
    expect(topSoldierIdx).toBeGreaterThan(-1);
    expect(topBulwarkIdx).toBeLessThan(topSoldierIdx);

    // Bottom Player: 兵士列が先、防壁列が後
    const bottomSoldierIdx = bottomHtml.indexOf('data-testid="player-board-soldier-row"');
    const bottomBulwarkIdx = bottomHtml.indexOf('data-testid="player-board-bulwark-row"');
    expect(bottomSoldierIdx).toBeGreaterThan(-1);
    expect(bottomBulwarkIdx).toBeGreaterThan(-1);
    expect(bottomSoldierIdx).toBeLessThan(bottomBulwarkIdx);
  });

  it("3. 相手の手札表示はコンパクト化（ヘッダーのHAND枚数のみ表示）され、秘密情報であるカード表面は一切描画されないこと", () => {
    const opponentHtml = renderToString(
      <PlayerBoard
        playerKey="p2"
        viewModel={createViewModel({
          playerKey: "p2",
          name: "Player B",
          isViewer: false,
          isTurnPlayer: false,
          isChancePlayer: false,
          isFocusPlayer: false,
          lifeDisplay: "10以上",
          handCount: 4,
          handCards: [{ id: "opp-secret", code: "S13", suit: "S", rank: 13, value: 13 }],
          fieldUnits: [],
        })}
        position="top"
      />
    );

    // ヘッダーに HAND: 4 は表示されるが、player-board-hand-section は描画されず秘密カード内容も漏洩しない
    expect(opponentHtml).toContain("HAND:");
    expect(opponentHtml).not.toContain('data-testid="player-board-hand-section"');
    expect(opponentHtml).not.toContain("HAND (手札:");
  });

  it("4. DRIVEカードの回転時レイアウトで不必要な縦膨張(my-3)が排除され、CHARGE/DRIVEで同一寸法の固定スロット(w-[56px] min-h-[50px])とクリック領域が維持されること", () => {
    const onChargeClick = vi.fn();
    const onDriveClick = vi.fn();

    let chargeRenderer!: TestRenderer.ReactTestRenderer;
    let driveRenderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      chargeRenderer = TestRenderer.create(
        <UnitCard
          unit={sampleUnits[0]}
          selectionMarker={{ badge: "①", isSelected: false }}
          onClick={onChargeClick}
        />
      );
      driveRenderer = TestRenderer.create(
        <UnitCard
          unit={sampleUnits[1]}
          selectionMarker={{ badge: "②", isSelected: true }}
          onClick={onDriveClick}
        />
      );
    });

    const chargeSlot = chargeRenderer.root.findByProps({ "data-testid": "unit-card-visual-slot" });
    const driveSlot = driveRenderer.root.findByProps({ "data-testid": "unit-card-visual-slot" });

    // どちらも my-3 を持たず、w-[56px] min-h-[50px] my-0 で統一された高さを維持
    expect(String(chargeSlot.props.className)).toContain("w-[56px] min-h-[50px]");
    expect(String(chargeSlot.props.className)).not.toContain("my-3");
    expect(String(driveSlot.props.className)).toContain("w-[56px] min-h-[50px]");
    expect(String(driveSlot.props.className)).toContain("rotate-90 scale-90 my-0");
    expect(String(driveSlot.props.className)).not.toContain("my-3");

    // クリック領域・選択操作が正常に機能すること
    const driveRoot = driveRenderer.root.findByProps({ "data-testid": "unit-card-u-soldier-drive" });
    act(() => {
      driveRoot.props.onClick();
    });
    expect(onDriveClick).toHaveBeenCalledTimes(1);
  });

  it("5. StagePanelが空状態のとき省スペース表示になり、リクエスト積載時はmax-h制限付き独立スクロールコンテナを持つこと", () => {
    const emptyHtml = renderToString(<StagePanel requests={[]} />);
    expect(emptyHtml).toContain('data-testid="stage-panel-empty"');
    expect(emptyHtml).toContain("py-0.5");

    const loadedHtml = renderToString(
      <StagePanel
        requests={[
          { id: "req-1", actionId: "attack", controller: "p1", status: "pending" },
          { id: "req-2", actionId: "magic_arrow", controller: "p2", status: "pending" },
        ]}
      />
    );
    expect(loadedHtml).toContain('data-testid="stage-panel-requests"');
    expect(loadedHtml).toContain("max-h-28 xl:max-h-36 overflow-y-auto");
  });
});
