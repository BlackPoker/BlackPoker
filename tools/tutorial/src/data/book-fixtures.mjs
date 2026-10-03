import { makeBulwarkFixture } from "./bulwark-fixture.mjs";

// 旧30操作は保存データの復元用に保持する。各教材の盤面は独立して複製する。
function swapPlayers(step) {
  const swap = (player) => player === "A" ? "B" : player === "B" ? "A" : player;
  const text = (value) => value.replace(/PLAYER ([AB])/g, (_, player) => `PLAYER ${swap(player)}`);
  for (const phase of ["before", "after"]) {
    const board = step.board[phase];
    step.board[phase] = { A: board.B, B: board.A, turn: swap(board.turn) };
  }
  step.actor = swap(step.actor);
  step.operations.forEach((operation) => { operation.player = swap(operation.player); operation.label = text(operation.label); });
  step.focusZones?.forEach((focus) => { focus.player = swap(focus.player); });
  if (step.interaction?.kind === "select-target") step.interaction.targetCard.player = swap(step.interaction.targetCard.player);
  for (const key of Object.keys(step)) if (typeof step[key] === "string") step[key] = text(step[key]);
  if (step.cause) step.cause.text = text(step.cause.text);
  if (step.alternate) for (const key of ["title", "text"]) step.alternate[key] = text(step.alternate[key]);
}

export function makeBookFixtures(base) {
  const fixtures = base.scenes.map((original) => {
    const scene = structuredClone(original);
    let steps = scene.stepIds.map((id) => structuredClone(base.steps.find((step) => step.id === id)));
    if (scene.id === "first-battle") {
      steps = steps.slice(1); // 相手はすでにアタックしている。あなたのブロックから体験。
      scene.cues = scene.cues.slice(1);
      steps.forEach(swapPlayers);
      scene.intro = "相手が♣6でアタックしました。あなたの♥7で守ります。";
      steps[0].boardNote = scene.intro;
      steps[1].automatic = true;
      steps[1].instruction = "6 ＜ 7：相手の♣6が墓地へ移ります。";
    }
    if (scene.id === "player-b-turn") {
      steps = steps.slice(0, 2); // 防壁設置だけ。ターン終了は別Sectionの責務。
      scene.cues = ["コストL：1点ダメージ", "手札を裏・縦で防壁へ"];
      steps.forEach(swapPlayers);
      scene.intro = "あなたのライフでコストLを払い、手札を防壁にします。";
      scene.summary = "1点ダメージを受け、手札1枚を裏向き・チャージ状態で防壁に設置しました。";
    }
    if (scene.id === "unblocked-attack") {
      steps.slice(1).forEach((step) => { step.automatic = true; });
      steps[1].instruction = "相手はブロッカーを指定しません。攻撃が通りました。";
      steps[2].instruction = "攻撃が通ったので、相手のライフが1枚ずつ、合計2枚減ります。";
      scene.intro = "あなたの♠2でアタック。今回は相手がブロックしない例です。";
    }
    if (scene.id === "pass-turn") {
      steps.slice(1).forEach((step) => { step.automatic = true; });
      steps[1].instruction = "相手のターンになり、相手のキャラクターがチャージします。";
      steps[2].instruction = "チャージに続いて、相手がライフからドローします。";
      scene.intro = "あなたがエンドすると、相手のターンが始まります。";
    }
    scene.stepIds = steps.map((step) => step.id);
    return { ...structuredClone(base), id: `book-${scene.id}`, userPlayer: "A", scenes: [scene], steps };
  });
  const wall = makeBulwarkFixture(base);
  wall.userPlayer = "A";
  wall.steps.forEach(swapPlayers);
  wall.steps.find((step) => step.id === "wall-attacker").automatic = true;
  wall.steps.find((step) => step.id === "wall-attacker").instruction = "数字が一致したので、相手の♣6が墓地へ移ります。";
  wall.scenes[0].intro = "相手が♣6でアタックしました。あなたの裏向き・チャージ状態の防壁で守ります。";
  wall.steps[0].boardNote = wall.scenes[0].intro;
  fixtures.push(wall);
  // 実物の開始手順は順序・先攻選択を変更しない。固定sceneの重複登録はしない。
  fixtures.push({ ...structuredClone(base), id: "book-real", scenes: [], steps: structuredClone(base.steps.filter((step) => step.mode === "real")) });
  return fixtures;
}
