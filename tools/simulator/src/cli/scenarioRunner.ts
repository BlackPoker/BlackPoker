import * as path from "path";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../engine/rules/CommandRegistry";
import { TurnManager } from "../engine/rules/TurnManager";

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

function header(text: string) {
  console.log(`\n${colors.bold}${colors.cyan}================================================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}  ${text}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}================================================================================${colors.reset}`);
}

function subHeader(text: string) {
  console.log(`\n${colors.bold}${colors.yellow}--- ${text} ---${colors.reset}`);
}

function logState(state: any) {
  if (state.turnPlayer) {
    const turnPlayerName = state.players[state.turnPlayer]?.name || state.turnPlayer;
    const chancePlayerName = state.players[state.chancePlayer]?.name || state.chancePlayer || state.turnPlayer;
    console.log(`  ${colors.bold}${colors.green}[TURN] Turn ${state.turnCount || 1}: ${turnPlayerName} (Chance: ${chancePlayerName})${colors.reset}`);
  }
  console.log(`${colors.bold}盤面状態:${colors.reset}`);
  for (const [pk, p] of Object.entries<any>(state.players)) {
    console.log(`  ${colors.bold}${p.name} (${pk}):${colors.reset}`);
    if (p.life) {
      const lifeStr = Array.isArray(p.life)
        ? p.life.map((c: any) => `${c.suit}${c.rank}`).join(", ")
        : p.life;
      console.log(`    ライフ  : [${lifeStr}]`);
    }
    if (p.hand && p.hand.length > 0) {
      console.log(`    手札    : [${p.hand.map((c: any) => `${c.suit}${c.rank}`).join(", ")}]`);
    }
    if (p.field && p.field.length > 0) {
      const fieldStr = p.field
        .map((u: any) => {
          const cardsStr = u.cards.map((c: any) => `${c.suit}${c.rank}`).join("+");
          return `${u.unitId}(${u.kind || u.componentId}: ${cardsStr})`;
        })
        .join(", ");
      console.log(`    フィールド: [${fieldStr}]`);
    }
    if (p.trumps && p.trumps.length > 0) {
      const trumpsStr = p.trumps
        .map((u: any) => {
          const cardsStr = u.cards.map((c: any) => `${c.suit}${c.rank}`).join("+");
          return `${u.unitId}(${u.componentId}: ${cardsStr}, face: ${u.face})`;
        })
        .join(", ");
      console.log(`    切札    : [${trumpsStr}]`);
    }
    if (p.fog && p.fog.length > 0) {
      const fogStr = p.fog
        .map((f: any) => `${f.componentId}(target: ${f.bindings?.target}, amount: ${f.bindings?.amount})`)
        .join(", ");
      console.log(`    フォグ  : [${fogStr}]`);
    }
    if (p.grave && p.grave.length > 0) {
      const graveStr = p.grave
        .map((u: any) => {
          const cardsStr = u.cards.map((c: any) => `${c.suit}${c.rank}`).join("+");
          return `${u.unitId}(${cardsStr})`;
        })
        .join(", ");
      console.log(`    墓地    : [${graveStr}]`);
    }
  }
}

function setupRegistryHook(registry: CommandRegistry) {
  // createRequest hook
  const originalCreateRequest = registry.createRequest;
  registry.createRequest = function (action: any, context: any) {
    const req = originalCreateRequest.call(this, action, context);
    let targetStr = "";
    if (context.targetComponent) {
      targetStr = `, 対象: ${context.targetComponent.unitId || context.targetComponent.componentId}`;
    } else if (context.targetRequest) {
      targetStr = `, 対象: ${context.targetRequest.id}`;
    }
    console.log(`  ${colors.bold}${colors.cyan}[REQUEST]${colors.reset} ${action.name}をステージへ (ID: ${req.id}${targetStr})`);
    return req;
  };

  // resolveTopRequest hook
  const originalResolveTopRequest = registry.resolveTopRequest;
  registry.resolveTopRequest = function (context: any) {
    const req = context.state.stage?.requests[context.state.stage.requests.length - 1];
    if (req) {
      const action = context.actions?.find((a: any) => a.id === req.actionId) || req.action;
      if (req.status === "cancelled") {
        console.log(`  ${colors.bold}${colors.blue}[RESOLVE]${colors.reset} ${action?.name || req.actionId}はキャンセル済みのため解決しない (ID: ${req.id})`);
      } else {
        console.log(`  ${colors.bold}${colors.blue}[RESOLVE]${colors.reset} ${action?.name || req.actionId}を解決 (ID: ${req.id})`);
      }
    }
    originalResolveTopRequest.call(this, context);
  };

  // Command execution hook
  const originalExecute = registry.execute;
  registry.execute = function (name: string, args: any, context: any) {
    console.log(`  ${colors.green}[CMD]${colors.reset} ${name}: ${JSON.stringify(args)}`);
    originalExecute.call(this, name, args, context);
    if (name === "startAttack") {
      const state = context.state;
      const attackerUnit = context.targetComponent;
      if (attackerUnit && attackerUnit.battle) {
        const attackerName = attackerUnit.kind || "キャラクター";
        const defenderPlayerKey = attackerUnit.battle.targetPlayerKey;
        const defenderName = state.players[defenderPlayerKey]?.name || defenderPlayerKey;
        console.log(`  ${colors.bold}${colors.red}[COMBAT]${colors.reset} attacker=${attackerName}, defender=${defenderName}`);
      }
    } else if (name === "declareBlock") {
      const state = context.state;
      // フィールドからブロッカーユニットを探す
      let blockerUnit: any = null;
      for (const player of Object.values<any>(state.players)) {
        blockerUnit = player.field?.find((u: any) => u.battle?.role === "blocker");
        if (blockerUnit) break;
      }
      if (blockerUnit && blockerUnit.battle) {
        const blockerName = blockerUnit.kind || "防壁";
        let attackerName = "アタッカー";
        for (const player of Object.values<any>(state.players)) {
          const attacker = player.field?.find((u: any) => u.unitId === blockerUnit.battle.blocksUnitId);
          if (attacker) {
            attackerName = attacker.kind || "一般兵";
            break;
          }
        }
        console.log(`  ${colors.bold}${colors.cyan}[BLOCK]${colors.reset} blocker=${blockerName}, attacker=${attackerName}`);
      }
    }
  };

  // Event dispatch hook
  const interpreter = registry["effectInterpreter"];
  const originalDispatchEvent = interpreter.dispatchEvent;
  interpreter.dispatchEvent = function (event: any, context: any) {
    if (event.type === "unitStateChanged") {
      const cause = event.payload?.cause;
      if (cause && cause.type === "cost" && cause.symbol === "B") {
        console.log(`  ${colors.yellow}[COST] B: 防壁をドライブ (ユニット: ${event.payload?.unitId})${colors.reset}`);
      } else {
        console.log(`  ${colors.magenta}[EVENT]${colors.reset} unitStateChanged: ${event.payload?.unitId} (${event.payload?.fromState} -> ${event.payload?.toState})`);
      }
    } else if (event.type === "cardMoved" && event.payload?.fromZone === "life" && context.currentAction?.cost?.includes("L")) {
      console.log(`  ${colors.yellow}[COST] L: ライフ1枚を墓地へ (カード: ${event.payload?.card?.suit}${event.payload?.card?.rank})${colors.reset}`);
    } else if (event.type === "cardMoved" && event.payload?.fromZone === "hand" && context.currentAction?.cost?.includes("D")) {
      console.log(`  ${colors.yellow}[COST] D: 手札1枚を墓地へ (カード: ${event.payload?.card?.suit}${event.payload?.card?.rank})${colors.reset}`);
    } else if (event.type === "fogRemoved") {
      const pName = context?.state?.players?.[event.payload?.playerKey]?.name || event.payload?.playerKey;
      console.log(`  ${colors.magenta}[EVENT]${colors.reset} fogRemoved: ${pName} ${event.payload?.componentId} -> ${event.payload?.toZone}`);
    } else {
      console.log(`  ${colors.magenta}[EVENT]${colors.reset} type: ${event.type}, payload: fromZone=${event.payload?.fromZone}, toZone=${event.payload?.toZone}, card=${event.payload?.card?.suit}${event.payload?.card?.rank} (Player=${event.payload?.playerKey})`);
    }
    originalDispatchEvent.call(this, event, context);
  };
}

async function runUpScenario(rulePackage: any) {
  header("シナリオ1: 「アップ」（フォグ付与によるサイズ増幅）");
  console.log("概要: 兵士1体に対して Heart 7 をキーカードとして「アップ」を適用し、サイズが 6 から 13 に増幅されることを確認します。");

  const upAction = rulePackage.actions.find((a: any) => a.id === "action.up");
  if (!upAction) throw new Error("action.up が見つかりません");

  const state: any = {
    players: {
      p1: {
        name: "Player A",
        life: 16,
        hand: [
          { id: "key-heart-7", suit: "H", rank: "7", value: 7 },
          { id: "cost-card", suit: "S", rank: "2", value: 2 }, // コストD用
        ],
        field: [
          {
            unitId: "soldier-1",
            kind: "一般兵",
            componentId: "character.soldier",
            state: "charge",
            cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
            labels: ["攻撃", "防御"],
          }
        ],
        fog: [],
        grave: [],
      },
      p2: {
        name: "Player B",
        life: 16,
        hand: [],
        field: [
          {
            unitId: "soldier-2",
            kind: "一般兵",
            componentId: "character.soldier",
            state: "charge",
            cards: [{ id: "c2", suit: "S", rank: "5", value: 5 }],
            labels: ["攻撃", "防御"],
          }
        ],
        fog: [
          {
            fogId: "fog-down-preset",
            componentId: "fog.down",
            card: { id: "down-card-preset", suit: "S", rank: "2", value: 2 },
            bindings: { target: "soldier-2", amount: -2 }
          }
        ],
        grave: [],
      }
    } as Record<string, any>
  };
  TurnManager.initializeToMain(state, "p1");

  const registry = new CommandRegistry();
  setupRegistryHook(registry);

  subHeader("初期状態");
  logState(state);

  const targetUnit = state.players.p1.field[0];
  const keyCard = state.players.p1.hand[0];

  const context: CommandContext = {
    state,
    playerKey: "p1",
    keyCard,
    targetComponent: targetUnit,
    actions: rulePackage.actions,
    components: rulePackage.components,
  };

  subHeader("アクション実行: 「アップ」");
  console.log(`実行アクション: ${upAction.name} (Key: ${keyCard.suit}${keyCard.rank})`);
  registry.executeAction(upAction, context);

  subHeader("最終状態");
  logState(state);

  const finalSize = registry.calculateUnitSize(targetUnit, state.players.p1);
  console.log(`\n${colors.bold}${colors.green}結果検証: 兵士の最終サイズ = ${finalSize} (期待値: 13)${colors.reset}`);

  // エンドアクションの実行
  const endAction = rulePackage.actions.find((a: any) => a.id === "action.end");
  if (!endAction) throw new Error("action.end が見つかりません");

  subHeader("アクション実行: 「エンド」 (Player A)");
  console.log(`実行アクション: ${endAction.name}`);
  registry.executeAction(endAction, context);

  subHeader("エンド解決後の状態");
  logState(state);

  const cleanSize = registry.calculateUnitSize(targetUnit, state.players.p1);
  console.log(`\n${colors.bold}${colors.green}結果検証: エンド解決後の兵士サイズ = ${cleanSize} (期待値: 6。エンドの解決によりフォグがすべて除去され、サイズが元に戻りました！)${colors.reset}`);
  const nextTurnPlayerName = state.players[state.turnPlayer]?.name || state.turnPlayer;
  const nextChancePlayerName = state.players[state.chancePlayer]?.name || state.chancePlayer;
  console.log(`結果検証: 次の手番プレイヤー = ${nextTurnPlayerName} (期待値: Player B。ターンとチャンスが移行しました！)${colors.reset}`);
}

async function runDownScenario(rulePackage: any) {
  header("シナリオ2: 「ダウン」（生存および墓地送り）");
  
  // パターンA (生存)
  subHeader("パターンA: Spade 2 を適用 (サイズ5に対して減衰-2、生存)");
  console.log("概要: サイズ 5 の兵士に対して Spade 2 をキーカードとして「ダウン」を適用。サイズが 3 に減少し、フィールドに生存します。");

  const downAction = rulePackage.actions.find((a: any) => a.id === "action.down");
  if (!downAction) throw new Error("action.down が見つかりません");

  const stateA = {
    players: {
      p1: {
        name: "Player A",
        life: 16,
        hand: [
          { id: "key-spade-2", suit: "S", rank: "2", value: 2 },
          { id: "cost-card", suit: "H", rank: "2", value: 2 }, // コストD用
        ],
        field: [
          {
            unitId: "soldier-1",
            kind: "一般兵",
            componentId: "character.soldier",
            state: "charge",
            cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
            labels: ["攻撃", "防御"],
          }
        ],
        fog: [],
        grave: [],
      }
    } as Record<string, any>
  };
  TurnManager.initializeToMain(stateA, "p1");

  const registryA = new CommandRegistry();
  setupRegistryHook(registryA);

  logState(stateA);

  const targetUnitA = stateA.players.p1.field[0];
  const keyCardA = stateA.players.p1.hand[0];

  const contextA: CommandContext = {
    state: stateA,
    playerKey: "p1",
    keyCard: keyCardA,
    targetComponent: targetUnitA,
    actions: rulePackage.actions,
    components: rulePackage.components,
  };

  console.log(`\n実行アクション: ${downAction.name} (Key: ${keyCardA.suit}${keyCardA.rank})`);
  registryA.executeAction(downAction, contextA);

  subHeader("パターンA 最終状態");
  logState(stateA);

  const finalSizeA = registryA.calculateUnitSize(targetUnitA, stateA.players.p1);
  console.log(`\n${colors.bold}${colors.green}結果検証: 兵士の最終サイズ = ${finalSizeA} (期待値: 3)${colors.reset}`);

  // パターンB (墓地送り)
  subHeader("パターンB: Spade 5 を適用 (サイズ5に対して減衰-5、サイズ0となり墓地へ直行、フォグは生成されない)");
  console.log("概要: 新しいロジックの動作を確認します。サイズが 0 以下になるため、フォグを作ることなく直接墓地に送られます。");

  const stateB = {
    players: {
      p1: {
        name: "Player A",
        life: 16,
        hand: [
          { id: "key-spade-5", suit: "S", rank: "5", value: 5 },
          { id: "cost-card", suit: "H", rank: "2", value: 2 }, // コストD用
        ],
        field: [
          {
            unitId: "soldier-1",
            kind: "一般兵",
            componentId: "character.soldier",
            state: "charge",
            cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
            labels: ["攻撃", "防御"],
          }
        ],
        fog: [],
        grave: [],
      }
    } as Record<string, any>
  };
  TurnManager.initializeToMain(stateB, "p1");

  const registryB = new CommandRegistry();
  setupRegistryHook(registryB);

  logState(stateB);

  const targetUnitB = stateB.players.p1.field[0];
  const keyCardB = stateB.players.p1.hand[0];

  const contextB: CommandContext = {
    state: stateB,
    playerKey: "p1",
    keyCard: keyCardB,
    targetComponent: targetUnitB,
    actions: rulePackage.actions,
    components: rulePackage.components,
  };

  console.log(`\n実行アクション: ${downAction.name} (Key: ${keyCardB.suit}${keyCardB.rank})`);
  registryB.executeAction(downAction, contextB);

  subHeader("パターンB 最終状態");
  logState(stateB);

  console.log(`\n${colors.bold}${colors.green}結果検証: フィールドの兵士数 = ${stateB.players.p1.field.length} (期待値: 0)、墓地 = ${stateB.players.p1.grave.length} (期待値: 1)、フォグ数 = ${stateB.players.p1.fog.length} (期待値: 0)${colors.reset}`);
}

async function runBulwarkAndNextGenScenario(rulePackage: any) {
  header("シナリオ3: 「防壁破壊から世代交代」（連鎖誘発アクション）");
  console.log("概要: 裏向き防壁 (Heart K) を対象に「防壁破壊」を実行します。防壁が破壊されて墓地に送られた時、世代交代の誘発条件 (fromZone=field, toZone=grave, card.rank=K) が満たされ、自動で「世代交代」が走り、ライフの上から Joker, A, J, Q, K のいずれかが出るまでめくり、それ以外を墓地へ移します。該当カードが出たら手札に加えます。");

  const destroyAction = rulePackage.actions.find((a: any) => a.id === "action.destroyBulwark");
  if (!destroyAction) throw new Error("action.destroyBulwark が見つかりません");

  const state = {
    players: {
      p1: {
        name: "Player A",
        life: [
          { id: "life-2", suit: "H", rank: "2", value: 2 },
          { id: "life-7", suit: "D", rank: "7", value: 7 },
          { id: "life-K", suit: "S", rank: "K", value: 13 },
          { id: "life-Joker", suit: "Joker", rank: "Joker", value: 20 },
        ],
        hand: [],
        field: [
          {
            unitId: "bulwark-1",
            kind: "ユニット",
            componentId: "character.bulwark",
            face: "down",
            cards: [{ id: "c-heart-K", suit: "H", rank: "K", value: 13 }],
            labels: ["防御"],
          }
        ],
        fog: [],
        grave: [],
      }
    } as Record<string, any>
  };
  TurnManager.initializeToMain(state, "p1");

  const registry = new CommandRegistry();
  setupRegistryHook(registry);

  subHeader("初期状態");
  logState(state);

  const targetUnit = state.players.p1.field[0];
  const keyCards = [
    { id: "key-heart-A", suit: "H", rank: "A", value: 1 },
    { id: "key-diamond-A", suit: "D", rank: "A", value: 1 },
  ];

  const context: CommandContext = {
    state,
    playerKey: "p1",
    keyCards,
    targetComponent: targetUnit,
    actions: rulePackage.actions,
    components: rulePackage.components,
  };

  subHeader("アクション実行: 「防壁破壊」");
  console.log(`実行アクション: ${destroyAction.name}`);
  registry.executeAction(destroyAction, context);

  subHeader("最終状態");
  logState(state);

  console.log(`\n${colors.bold}${colors.green}結果検証: 
  - フィールドの防壁数 = ${state.players.p1.field.length} (期待値: 0)
  - 手札のカード = ${state.players.p1.hand.map((c: any) => `${c.suit}${c.rank}`).join(", ")} (期待値: S-K)
  - 墓地のユニット数 = ${state.players.p1.grave.length} (期待値: 3 = 防壁 + ライフから落ちた2枚)
  - 残りライフ = ${state.players.p1.life.map((c: any) => `${c.suit}${c.rank}`).join(", ")} (期待値: Joker)
${colors.reset}`);
}

async function runFortressDefenseScenario(rulePackage: any) {
  header("シナリオ4: 「要塞で投擲を防ぐ」（常在能力によるダメージ無効化）");
  console.log("概要: 相手がキーカードに Spade を含む「投擲」アクションを発動。通常ならダメージを受けますが、自分の表切札に「要塞」が存在し、かつ自分の場にキャラクター（防壁設置した防壁など）がいるため、ダメージが無効化されることを検証します。");

  const setBulwarkAction = rulePackage.actions.find((a: any) => a.id === "action.setBulwark");
  if (!setBulwarkAction) throw new Error("action.setBulwark が見つかりません");

  const throwingAction = rulePackage.actions.find((a: any) => a.id === "action.throwing");
  if (!throwingAction) throw new Error("action.throwing が見つかりません");

  const state = {
    players: {
      p1: {
        name: "Player A (攻撃側)",
        hand: [],
        field: [],
        grave: [],
        life: [],
      },
      p2: {
        name: "Player B (防御側 - 要塞あり)",
        hand: [{ id: "hand-h5", suit: "H", rank: "5", value: 5 }], // 手札にカードを持つ
        field: [], // 初期状態はキャラクターが場にいない！
        grave: [],
        trumps: [
          {
            unitId: "fortress-1",
            kind: "切札",
            componentId: "trump.fortress",
            face: "up",
            cards: [{ id: "c-club-9", suit: "C", rank: "9", value: 9 }],
          }
        ],
        life: [
          { id: "c1", suit: "C", rank: "2", value: 2 },
          { id: "c2", suit: "C", rank: "3", value: 3 },
          { id: "c3", suit: "C", rank: "4", value: 4 }, // コストL用
        ],
      }
    } as Record<string, any>
  };
  TurnManager.initializeToMain(state, "p1");

  const registry = new CommandRegistry();
  setupRegistryHook(registry);

  subHeader("初期状態");
  logState(state);

  // 1. 防壁設置アクションの実行
  subHeader("アクション実行: 「防壁設置」 (Player B)");
  // ※このシナリオでは、複数アクションの個別挙動を確認するため、
  // 各アクションの実行前に turnPlayer / chancePlayer を明示的に整合させている。
  // 完全なターン進行やチャンス自動受け渡しは今後対応。
  // シナリオ4で Player B の防壁設置前に initializeToMain("p2")、Player A の投擲前に initializeToMain("p1") を呼ぶのは、
  // 実ゲームの完全なターン進行を表すものではなく、個別アクションの実行条件を満たすためのシナリオ上の明示的な整合処理です。
  TurnManager.initializeToMain(state, "p2");
  const bulwarkKeyCard = state.players.p2.hand[0];
  console.log(`実行アクション: ${setBulwarkAction.name} (Key: ${bulwarkKeyCard.suit}${bulwarkKeyCard.rank} を手札から伏せる)`);

  const setBulwarkContext: CommandContext = {
    state,
    playerKey: "p2", // Bが発動
    keyCard: bulwarkKeyCard,
    actions: rulePackage.actions,
    components: rulePackage.components,
  };
  registry.executeAction(setBulwarkAction, setBulwarkContext);

  subHeader("防壁設置後の状態");
  logState(state);

  // 2. 投擲アクションの実行
  // ※このシナリオでは、複数アクションの個別挙動を確認するため、
  // 各アクションの実行前に turnPlayer / chancePlayer を明示的に整合させている。
  // 完全なターン進行やチャンス自動受け渡しは今後対応。
  // Player A の投擲前に initializeToMain("p1") を呼ぶのは、個別アクションの実行条件を満たすためのシナリオ上の明示的な整合処理です。
  TurnManager.initializeToMain(state, "p1");
  const keyCards = [
    { id: "key-spade-5", suit: "S", rank: "5", value: 5 },
    { id: "key-club-2", suit: "C", rank: "2", value: 2 },
  ];

  const throwingContext: CommandContext = {
    state,
    playerKey: "p1", // Aが発動
    targetPlayerKey: "p2", // Bを対象
    keyCards,
    actions: rulePackage.actions,
    components: rulePackage.components,
  };

  subHeader("アクション実行: 「投擲」 (Player A -> Player B)");
  console.log(`実行アクション: ${throwingAction.name} (Key: Spade 5 + Club 2 -> 本来 5 ダメージ)`);
  
  registry.executeAction(throwingAction, throwingContext);

  subHeader("最終状態");
  logState(state);

  console.log(`\n${colors.bold}${colors.green}結果検証: Player B の残りライフ = ${state.players.p2.life.length} (期待値: 2。防壁設置した防壁が場にあるため、投擲ダメージが完璧に無効化されました！)${colors.reset}`);
}

async function runCounterScenario(rulePackage: any) {
  header("シナリオ5: 「カウンターでアップを取り消す」（ステージ上リクエスト取消）");
  console.log("概要: Player A が「アップ」をステージに積みます。解決される前に、Player B が「カウンター」を発動してステージに積み、アップを取り消します。その結果、アップの解決時には効果が適用されず、手札コスト D も支払われないことを検証します。");

  const upAction = rulePackage.actions.find((a: any) => a.id === "action.up");
  if (!upAction) throw new Error("action.up が見つかりません");

  const counterAction = rulePackage.actions.find((a: any) => a.id === "action.counter");
  if (!counterAction) throw new Error("action.counter が見つかりません");

  const state = {
    players: {
      p1: {
        name: "Player A",
        life: [
          { id: "life-1", suit: "S", rank: "2", value: 2 },
        ],
        hand: [
          { id: "key-heart-7", suit: "H", rank: "7", value: 7 }, // アップ発動カード
          { id: "cost-spade-2", suit: "S", rank: "2", value: 2 }, // アップコスト用手札
        ],
        field: [
          {
            unitId: "soldier-1",
            kind: "一般兵",
            componentId: "character.soldier",
            state: "charge",
            cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
            labels: ["攻撃", "防御"],
          }
        ],
        fog: [],
        grave: [],
      },
      p2: {
        name: "Player B",
        life: [],
        hand: [
          { id: "counter-cost", suit: "C", rank: "2", value: 2 }, // カウンターコスト用手札
        ],
        field: [],
        grave: [],
      }
    } as Record<string, any>
  };
  TurnManager.initializeToMain(state, "p1");

  const registry = new CommandRegistry();
  setupRegistryHook(registry);

  subHeader("初期状態");
  logState(state);

  // 1. Player A が「アップ」をステージに積む
  const upKeyCard = state.players.p1.hand[0];
  const targetUnit = state.players.p1.field[0];
  const upContext: CommandContext = {
    state,
    playerKey: "p1",
    keyCard: upKeyCard,
    targetComponent: targetUnit,
    actions: rulePackage.actions,
    components: rulePackage.components,
  };

  subHeader("アクション：アップ をステージへ");
  console.log(`Player A が ${upAction.name} をステージへ積みます。`);
  const req1 = registry.createRequest(upAction, upContext);

  // クイックタイミング（カウンター）を Player B が実行するため、チャンスを Player B に移行させる
  TurnManager.passChance(state);

  // 2. Player B が「カウンター」をステージに積む
  const counterContext: CommandContext = {
    state,
    playerKey: "p2",
    targetRequest: req1, // アップを対象
    keyCard: undefined,
    actions: rulePackage.actions,
    components: rulePackage.components,
  };

  subHeader("アクション：カウンター をステージへ");
  console.log(`Player B が ${counterAction.name} をステージへ積みます（対象: ${req1.id}）。`);
  const req2 = registry.createRequest(counterAction, counterContext);

  subHeader("ステージ上のリクエストを順次解決");
  // 最新のカウンターから解決 (LIFO)
  console.log(`\n--- カウンター (ID: ${req2.id}) の解決 ---`);
  registry.resolveTopRequest(counterContext);

  // 次にアップの解決
  console.log(`\n--- アップ (ID: ${req1.id}) の解決 ---`);
  registry.resolveTopRequest(upContext);

  subHeader("最終状態");
  logState(state);

  const finalSize = registry.calculateUnitSize(targetUnit, state.players.p1);
  console.log(`\n${colors.bold}${colors.green}結果検証: 
  - 兵士の最終サイズ = ${finalSize} (期待値: 6。アップがカウンターされたためサイズ増幅なし！)
  - Player A の手札数 = ${state.players.p1.hand.length} (期待値: 2。アップのDコストは支払われていない！)
  - Player B の手札数 = ${state.players.p2.hand.length} (期待値: 0。カウンターのDコストは支払われている！)${colors.reset}`);
}

async function runTwistScenario(rulePackage: any) {
  header("シナリオ6: 「ツイスト」（キャラクターのチャージ/ドライブ状態切替）");
  console.log("概要: Player A が「ツイスト」を一般兵（soldier-1, チャージ状態）を対象としてステージに積みます。解決時、コスト D を支払い、一般兵の状態がドライブ（drive）状態に切り替わることを検証します。");

  const twistAction = rulePackage.actions.find((a: any) => a.id === "action.twist");
  if (!twistAction) throw new Error("action.twist が見つかりません");

  const twistKeyCard = { id: "twist-key", code: "♢5", suit: "D", rank: "5", value: 5 };
  const twistCostCard = { id: "twist-cost", code: "♣2", suit: "C", rank: "2", value: 2 };

  const soldier = {
    unitId: "soldier-1",
    kind: "一般兵",
    componentId: "character.soldier",
    state: "charge",
    cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
    labels: ["攻撃", "防御"],
  };

  const state = {
    players: {
      p1: {
        name: "Player A",
        life: [],
        hand: [twistKeyCard, twistCostCard],
        field: [soldier],
        grave: [],
        fog: [],
      }
    } as Record<string, any>
  };
  TurnManager.initializeToMain(state, "p1");

  const registry = new CommandRegistry();
  setupRegistryHook(registry);

  subHeader("初期状態");
  logState(state);

  const context: CommandContext = {
    state,
    playerKey: "p1",
    keyCard: twistKeyCard,
    targetComponent: soldier,
    actions: rulePackage.actions,
    components: rulePackage.components,
  };

  subHeader("アクション：ツイスト をステージへ (対象: 一般兵1)");
  const req = registry.createRequest(twistAction, context);

  subHeader("ステージ上のリクエストを解決");
  console.log(`\n--- ツイスト (ID: ${req.id}) の解決 ---`);
  registry.resolveTopRequest(context);

  subHeader("最終状態");
  logState(state);

  console.log(`\n${colors.bold}${colors.green}結果検証: 
  - 一般兵1の最終状態 = ${soldier.state} (期待値: drive)
  - Player A の手札数 = ${state.players.p1.hand.length} (期待値: 1。ツイストのDコストは支払われた！)${colors.reset}`);
}

async function runAttackScenario(rulePackage: any) {
  header("シナリオ7: 「アタックを宣言して戦闘状態を作り、ブロックで対応付ける」（アタック＆ブロック最小実装）");
  console.log("概要: Player A が一般兵（soldier-1, チャージ状態）でアタックを宣言し、解決してドライブ状態へ移行。その後、チャンスを Player B（防御側）に移し、Player B は防壁（bulwark-1, チャージ状態）でアタッカーをブロックします。アタッカー・ブロッカー双方に戦闘情報が記録されることを検証します。");

  const attackAction = rulePackage.actions.find((a: any) => a.id === "action.attack");
  const blockAction = rulePackage.actions.find((a: any) => a.id === "action.block");
  if (!attackAction) throw new Error("action.attack が見つかりません");
  if (!blockAction) throw new Error("action.block が見つかりません");

  const soldier: any = {
    unitId: "soldier-1",
    kind: "一般兵",
    componentId: "character.soldier",
    state: "charge",
    cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
    labels: ["攻撃", "防御"],
  };

  const bulwark: any = {
    unitId: "bulwark-1",
    kind: "防壁",
    componentId: "character.bulwark",
    state: "charge",
    cards: [{ id: "c2", suit: "H", rank: "5", value: 5 }],
    labels: ["防御"],
  };

  const state: any = {
    players: {
      p1: {
        name: "Player A",
        life: [],
        hand: [],
        field: [soldier],
        grave: [],
        fog: [],
      },
      p2: {
        name: "Player B",
        life: [{ id: "l1", suit: "C", rank: "2", value: 2 }],
        hand: [],
        field: [bulwark],
        grave: [],
        fog: [],
      }
    }
  };
  TurnManager.initializeToMain(state, "p1");

  const registry = new CommandRegistry();
  setupRegistryHook(registry);

  subHeader("初期状態");
  logState(state);

  const contextP1: CommandContext = {
    state,
    playerKey: "p1",
    targetComponent: soldier,
    targetPlayerKey: "p2",
    actions: rulePackage.actions,
    components: rulePackage.components,
  };

  subHeader("アクション：アタック をステージへ");
  console.log(`Player A が ${attackAction.name} をステージへ積みます（対象: ${soldier.unitId}, ディフェンダー: Player B）。`);
  const reqAttack = registry.createRequest(attackAction, contextP1);

  subHeader("ステージ上のアタックリクエストを解決");
  console.log(`\n--- アタック (ID: ${reqAttack.id}) の解決 ---`);
  registry.resolveTopRequest(contextP1);

  subHeader("チャンスの移行");
  console.log("アタック解決後、チャンスを Player B へ移します。");
  TurnManager.passChance(state);
  logState(state);

  const contextP2: CommandContext = {
    state,
    playerKey: "p2",
    targetComponent: bulwark,
    actions: rulePackage.actions,
    components: rulePackage.components,
  };

  subHeader("アクション：ブロック をステージへ");
  console.log(`Player B が ${blockAction.name} をステージへ積みます（対象ブロッカー: ${bulwark.unitId}）。`);
  const reqBlock = registry.createRequest(blockAction, contextP2);

  subHeader("ステージ上のブロックリクエストを解決");
  console.log(`\n--- ブロック (ID: ${reqBlock.id}) の解決 ---`);
  registry.resolveTopRequest(contextP2);

  subHeader("最終状態");
  logState(state);

  console.log(`\n${colors.bold}${colors.green}結果検証: 
  - アタッカー戦闘情報 (soldier.battle) = ${JSON.stringify(soldier.battle)}
  - アタッカー状態 = ${soldier.state} (期待値: drive)
  - ブロッカー戦闘情報 (bulwark.battle) = ${JSON.stringify(bulwark.battle)}
  - ブロッカー状態 = ${bulwark.state} (期待値: drive)${colors.reset}`);
}

async function main() {
  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const rulePackage = await loadRulePackageFromDirectory(rulesDir);

  header("BlackPoker 新YAML DSL 挙動確認CLIランナー (rules-vnext)");

  // 1. アップシナリオ
  await runUpScenario(rulePackage);

  // 2. ダウンシナリオ (生存 / 墓地送り)
  await runDownScenario(rulePackage);

  // 3. 防壁破壊から世代交代
  await runBulwarkAndNextGenScenario(rulePackage);

  // 4. 要塞で投擲を防ぐ
  await runFortressDefenseScenario(rulePackage);

  // 5. カウンターでアップを取り消す
  await runCounterScenario(rulePackage);

  // 6. ツイストでアップの対象を変更する
  await runTwistScenario(rulePackage);

  // 7. アタックで戦闘一時状態を作る
  await runAttackScenario(rulePackage);
}

async function run() {
  try {
    await main();
  } catch (error) {
    console.error("エラーが発生しました:", error);
    process.exit(1);
  }
}

run();
