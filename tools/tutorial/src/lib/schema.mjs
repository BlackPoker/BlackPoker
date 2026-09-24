const buckets = {
  action: "actions",
  character: "characters",
  fog: "fogs",
  frame: "frames",
  format: "formats",
};
const zones = ["hand", "soldiers", "bulwarks", "life", "grave"];
export function validateRuleRef(ref, catalog) {
  if (typeof ref !== "string") return "Tutorial reference must be a string";
  const dot = ref.indexOf(".");
  const bucket = buckets[ref.slice(0, dot)],
    id = ref.slice(dot + 1);
  return bucket && id && catalog[bucket] && Object.hasOwn(catalog[bucket], id)
    ? null
    : "Tutorial references unknown rule: " + ref;
}
export function validateScenario(value, catalog) {
  if (!value || typeof value !== "object")
    return ["Tutorial scenario must be an object"];
  const errors = [];
  if (value.schemaVersion !== 2)
    errors.push("Unsupported tutorial schemaVersion");
  if (!value.id || !value.title)
    errors.push("Tutorial id and title are required");
  if (!["beginner", "intermediate", "advanced"].includes(value.difficulty))
    errors.push("Invalid difficulty");
  if (!Array.isArray(value.steps) || !value.steps.length)
    return [...errors, "Tutorial steps are required"];
  const refs = [
    `format.${value.regulation?.format || ""}`,
    `frame.${value.regulation?.frame || ""}`,
  ];
  if (!Array.isArray(value.learn))
    errors.push("Tutorial learn must be an array");
  else refs.push(...value.learn);
  const ids = new Set(),
    chapters = new Set();
  let previous = null;
  for (const [index, s] of value.steps.entries()) {
    if (!s || typeof s !== "object") {
      errors.push("Step must be an object");
      continue;
    }
    if (!s.id || ids.has(s.id)) errors.push("Missing or duplicate step id");
    ids.add(s.id);
    for (const field of [
      "chapter",
      "chapterTitle",
      "title",
      "instruction",
      "explanation",
      "learned",
      "actionLabel",
    ])
      if (typeof s[field] !== "string" || !s[field])
        errors.push(`Step ${index}: ${field} is required`);
    if (!["A", "B", "both", "first"].includes(s.actor))
      errors.push("Invalid actor");
    if (!["fixed", "real"].includes(s.mode)) errors.push("Invalid mode");
    if (s.chooseFirst !== undefined && typeof s.chooseFirst !== "boolean")
      errors.push("Invalid first player selection");
    if (
      s.checklist !== undefined &&
      (!Array.isArray(s.checklist) ||
        s.checklist.some((c) => typeof c !== "string"))
    )
      errors.push("Invalid checklist");
    if (previous && previous.chapter !== s.chapter && chapters.has(s.chapter))
      errors.push("Chapter is not contiguous");
    chapters.add(s.chapter);
    if (!Array.isArray(s.ruleRefs)) errors.push("ruleRefs must be an array");
    else refs.push(...s.ruleRefs);
    if (s.cause !== undefined) {
      if (
        !s.cause ||
        !["request", "resolve", "trigger", "setup"].includes(s.cause.phase) ||
        typeof s.cause.text !== "string" ||
        !s.cause.text ||
        (s.cause.actionId !== undefined &&
          (typeof s.cause.actionId !== "string" ||
            !Object.hasOwn(catalog.actions || {}, s.cause.actionId)))
      ) errors.push("Invalid movement cause");
    }
    if (s.alternate !== undefined &&
      (!s.alternate || typeof s.alternate.title !== "string" ||
        !s.alternate.title || typeof s.alternate.text !== "string" ||
        !s.alternate.text)) errors.push("Invalid alternate example");
    if (s.focusZones !== undefined &&
      (!Array.isArray(s.focusZones) || s.focusZones.some((focus) =>
        !["A", "B"].includes(focus?.player) || !zones.includes(focus?.zone))))
      errors.push("Invalid focusZones");
    if (s.placementGuide !== undefined &&
      (typeof s.placementGuide !== "string" || !s.placementGuide))
      errors.push("Invalid placementGuide");
    for (const phase of ["before", "after"]) {
      const board = s.board?.[phase];
      if (!board || ![null, "A", "B"].includes(board.turn))
        errors.push("Invalid board turn");
      for (const p of ["A", "B"]) {
        const seen = new Set();
        for (const z of zones) {
          const cards = board?.[p]?.[z];
          if (!Array.isArray(cards)) {
            errors.push("Invalid board zone");
            continue;
          }
          for (const c of cards) {
            if (
              !c ||
              !/^[SHDC](A|[2-9]|10|J|Q|K)$/.test(c.card) ||
              !["charge", "drive"].includes(c.state) ||
              !["up", "down"].includes(c.face)
            )
              errors.push("Invalid board card");
            if (c && seen.has(c.card))
              errors.push("Duplicate card in player board");
            if (c) seen.add(c.card);
          }
        }
      }
    }
    if (!Array.isArray(s.operations))
      errors.push("operations must be an array");
    else if (s.cause?.phase === "setup" && s.operations.length)
      errors.push("Setup step must not contain game operations");
    else
      for (const o of s.operations) {
        if (
          !o ||
          !["A", "B"].includes(o.player) ||
          !zones.includes(o.from) ||
          !zones.includes(o.to) ||
          !Array.isArray(o.cards) ||
          !o.label
        ) {
          errors.push("Invalid operation");
          continue;
        }
        for (const code of o.cards) {
          const before = s.board?.before?.[o.player]?.[o.from];
          const after = s.board?.after?.[o.player]?.[o.to];
          if (
            !/^[SHDC](A|[2-9]|10|J|Q|K)$/.test(code) ||
            (!before?.some?.((c) => c?.card === code) &&
              !after?.some?.((c) => c?.card === code))
          )
            errors.push("Operation card is absent from its board");
        }
      }
    if (
      previous?.mode === "fixed" &&
      s.mode === "fixed" &&
      JSON.stringify(previous.board?.after) !== JSON.stringify(s.board?.before)
    )
      errors.push("Fixed board continuity is broken");
    previous = s;
  }
  if (!Array.isArray(value.scenes) || !value.scenes.length) {
    errors.push("Tutorial scenes are required");
  } else {
    const stepById = new Map(value.steps.map((step) => [step?.id, step]));
    const sceneIds = new Set(), usedSteps = new Set(), ordered = [];
    for (const scene of value.scenes) {
      if (!scene || typeof scene.id !== "string" || !scene.id || sceneIds.has(scene.id)) {
        errors.push("Missing or duplicate scene id");
        continue;
      }
      sceneIds.add(scene.id);
      if (!["static", "auto"].includes(scene.presentation)) errors.push("Invalid scene presentation");
      if (![scene.title, scene.intro, scene.summary].every((text) => typeof text === "string" && text))
        errors.push("Invalid scene text");
      if (!Array.isArray(scene.stepIds) || !scene.stepIds.length ||
        !Array.isArray(scene.cues) || scene.cues.length !== scene.stepIds?.length ||
        scene.cues.some((cue) => typeof cue !== "string" || !cue)) {
        errors.push("Invalid scene steps or cues");
        continue;
      }
      for (const id of scene.stepIds) {
        const step = stepById.get(id);
        if (!step || step.mode !== "fixed") errors.push("Scene references unknown fixed step: " + id);
        if (usedSteps.has(id)) errors.push("Fixed step belongs to multiple scenes: " + id);
        usedSteps.add(id);
        ordered.push(id);
      }
    }
    const fixedIds = value.steps.filter((step) => step?.mode === "fixed").map((step) => step.id);
    if (fixedIds.some((id) => !usedSteps.has(id))) errors.push("Fixed step is missing from scenes");
    if (JSON.stringify(ordered) !== JSON.stringify(fixedIds)) errors.push("Scene step order is invalid");
  }
  for (const ref of refs) {
    const error = validateRuleRef(ref, catalog);
    if (error) errors.push(error);
  }
  return [...new Set(errors)];
}
