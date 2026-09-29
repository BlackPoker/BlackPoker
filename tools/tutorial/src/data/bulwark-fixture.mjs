// 独立した教材盤面。既存の連続対戦へ架空のカード移動を挿入しない。
export function makeBulwarkFixture(base) {
  const template = base.steps.find((step) => step.id === "block");
  const board = structuredClone(template.board.before);
  // 各プレイヤーは別々のEntry16を持つ。BのライフC6と防壁D5を交換した初期fixture。
  for (const cards of Object.values(board.B)) for (const card of cards) {
    if (card.card === "C6") card.card = "D5";
    else if (card.card === "D5") card.card = "C6";
  }
  board.B.bulwarks.find((card) => card.card === "C6").face = "down";
  const steps = [];
  const add = (id, title, player, from, to, change, extra = {}) => {
    const before = structuredClone(board);
    change(board);
    steps.push({ ...template, id, chapter: "bulwark-block", chapterTitle: "攻防を深く知る",
      title, actor: player, instruction: title, explanation: title, learned: title, boardNote: title,
      cause: { phase: "resolve", actionId: "damageJudge", text: title },
      actionName: "ダメージ判定", actionLabel: title,
      ruleRefs: ["action.block", "action.damageJudge"],
      interaction: undefined, alternate: undefined,
      operations: [{ player, from, to, cards: ["C6"], label: title }],
      focusZones: [{ player, zone: from }, { player, zone: to }],
      board: { before, after: structuredClone(board) }, ...extra });
  };
  add("wall-choose", "防壁を選び、♣6をブロック", "B", "bulwarks", "bulwarks", () => {}, {
    actionName: "ブロック", cause: { phase: "resolve", actionId: "block", text: "防壁を選び、攻撃側の♣6を指定します。" },
    interaction: { kind: "select-target", targetCard: { player: "A", zone: "soldiers", card: "C6" } },
  });
  add("wall-reveal", "防壁をタップして表にする", "B", "bulwarks", "bulwarks", (b) => {
    b.B.bulwarks.find((c) => c.card === "C6").face = "up";
  });
  const move = (player, zone) => (b) => {
    const index = b[player][zone].findIndex((c) => c.card === "C6");
    const [card] = b[player][zone].splice(index, 1);
    b[player].grave.push({ ...card, face: "up", state: "charge" });
  };
  add("wall-attacker", "6 ＝ 6：攻撃側の♣6を墓地へ", "A", "soldiers", "grave", move("A", "soldiers"));
  add("wall-grave", "守った防壁も墓地へ", "B", "bulwarks", "grave", move("B", "bulwarks"));
  return { schemaVersion: 2, id: "bulwark-fixture-v1", title: "防壁で守ってみる",
    description: "一致した数字の防壁ブロックを体験する独立盤面", difficulty: "beginner",
    regulation: base.regulation, learn: ["action.block", "action.damageJudge"], steps,
    scenes: [{ id: "bulwark-block", title: "防壁で守ってみる", presentation: "interactive",
      stepIds: steps.map((step) => step.id), cues: ["防壁でブロック", "防壁を公開", "数字が一致", "防壁も墓地へ"],
      intro: "攻撃してきた♣6を、防壁で守ります。まずPLAYER Bの防壁を選びましょう。",
      summary: "防壁の6が攻撃側の6と一致したので、攻撃側と防壁が墓地へ。大小比較ではありません。" }] };
}
