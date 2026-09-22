import { useEffect, useRef, useState } from "react";
import { ruleCatalog } from "../generated/ruleCatalog";
import { BeginnerGuide } from "./BeginnerGuide";

const uses: Record<string, string> = {
  end: "自分の行動を終えて、相手へターンを渡します。",
  charge: "横向きのキャラクターを、もう一度使える縦向きへ戻します。",
  draw: "ライフの上からカードを引き、手札へ加えます。",
  attack: "兵士を横向きにして、相手を攻撃します。",
  block: "兵士や防壁を選び、相手の攻撃を防ぎます。",
  damageJudge: "攻撃と守りを比べ、カードやライフを動かします。",
  nextGeneration: "Aや絵札が場から墓地へ移ったときに起きます。",
  setBulwark: "手札のカード1枚を、攻撃を防ぐ防壁にします。",
  summonsSoldier: "手札の2〜10を、戦う兵士として場に出します。",
  summonsHero: "手札のJ〜Kを、強い兵士として場に出します。",
  summonsAce: "手札のAを、すぐ攻撃できる兵士として場に出します。",
  mountSoldier: "同じスートのカードを重ねて兵士を強くします。",
  up: "兵士の数字を、そのターンだけ大きくします。",
  down: "兵士の数字を、そのターンだけ小さくします。",
  twist: "キャラクターの縦向き・横向きを変えます。",
  counter: "相手が起こしたアクションを取り消します。",
  destroyBulwark: "相手の防壁を墓地へ移します。",
  throwing: "兵士を使わず、相手へダメージを与えます。",
  search: "Jokerを使い、ライフから必要なカードを探します。",
};

const actionSteps: Record<string, string[]> = {
  setBulwark: ["ライフの上1枚を墓地へ（L）", "手札1枚を裏向き・縦向きで防壁へ"],
  summonsSoldier: ["防壁を横向きにする（B）", "ライフの上1枚を墓地へ（L）", "手札の2〜10を表向き・縦向きで兵士へ"],
  attack: ["攻撃するチャージ状態の兵士を選ぶ", "選んだ兵士を横向きにする", "相手がブロックするか確認する"],
  end: ["手札が8枚以上なら7枚まで捨てる", "自分のターンを終える", "相手のチャージとドローへ進む"],
};

const costNames: Record<string, string> = {
  B: "防壁をドライブする",
  L: "1点ダメージを受ける",
  D: "手札を1枚捨てる",
  S: "キャラクター1体を墓地に移す",
  C: "キーユニットのキャラクターをドライブする",
};

const characterNotes: Record<string, string[]> = {
  soldier: ["2〜10", "場に出したターンは攻撃できない"],
  hero: ["J〜K", "場に出したターンは攻撃できない", "場から墓地へ行くと世代交代が起きる"],
  ace: ["A", "場に出したターンから攻撃できる", "場から墓地へ行くと世代交代が起きる"],
  armedsoldier: ["同じスートを2枚以上重ねた兵士", "重ねたカードの数字を合計する"],
  bulwark: ["裏向きで置く守りのキャラクター", "相手の攻撃をブロックできる"],
};

const firstActionIds = new Set([
  "end", "charge", "draw", "attack", "block", "damageJudge", "setBulwark", "summonsSoldier",
]);

export function ActionHelp({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"actions" | "characters">("actions");
  const [query, setQuery] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (dialog.current?.showModal) dialog.current.showModal();
    else dialog.current?.setAttribute("open", "");
  }, []);

  const actions = Object.entries(ruleCatalog.actions).filter(
    ([id, action]) =>
      (action.formats as readonly string[]).includes("lite") &&
      (action.name + action.group + action.key + (uses[id] || "")).includes(query),
  );
  const characters = Object.entries(ruleCatalog.characters).filter(
    ([, character]) =>
      (character.formats as readonly string[]).includes("lite") &&
      (character.name + character.key + character.type + character.labels).includes(query),
  );
  const actionGroups = [
    ["まず使うアクション", actions.filter(([id]) => firstActionIds.has(id))],
    ["その他のアクション", actions.filter(([id]) => !firstActionIds.has(id))],
  ] as const;

  return (
    <dialog className="action-help" ref={dialog} onCancel={onClose} aria-labelledby="help-title">
      <header>
        <div><small>対戦中も、ここを見ながら</small><h2 id="help-title">ルール早見</h2></div>
        <button onClick={onClose} aria-label="早見を閉じる">×</button>
      </header>
      <div className="help-tabs" role="tablist" aria-label="早見の種類">
        <button role="tab" aria-selected={tab === "actions"} onClick={() => { setTab("actions"); setQuery(""); }}>アクション</button>
        <button role="tab" aria-selected={tab === "characters"} onClick={() => { setTab("characters"); setQuery(""); }}>キャラクター</button>
      </div>
      <div className="help-scroll">
        {tab === "actions" ? <BeginnerGuide /> : (
          <section className="character-intro">
            <strong>キャラクターとは？</strong>
            <p>場にいる兵士や防壁のことです。攻撃したり、相手の攻撃を防いだりします。</p>
          </section>
        )}
        <label className="help-search">
          {tab === "actions" ? "アクションを検索" : "キャラクターを検索"}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tab === "actions" ? "例：兵士召喚、アタック" : "例：一般兵、エース、防壁"}
          />
        </label>

        {tab === "actions" && actionGroups.map(([title, items]) => items.length > 0 && (
          <section className="action-group" key={title}>
            <div className="action-group-title"><h3>{title}</h3><span>{items.length}件</span></div>
            {items.map(([id, action]) => (
              <article key={id} className="help-action">
                <h3>{action.name}</h3>
                <dl className="easy-rule">
                  <dt>何をする？</dt><dd>{uses[id] || action.group}</dd>
                  <dt>必要なカード</dt><dd>{action.key || (id === "setBulwark" ? "手札から好きな1枚" : "なし")}</dd>
                  <dt>コスト</dt><dd className="cost-code">{action.cost ? [...action.cost].join(" + ") : "なし"}</dd>
                </dl>
                {actionSteps[id] && <ol className="how-list">{actionSteps[id].map((step, index) => <li key={step}><b>{index + 1}</b><span>{step}</span></li>)}</ol>}
                {id === "search" && <p className="help-note">エントリー16にはJokerが入らないため使いません。</p>}
                <details>
                  <summary>もっと詳しく</summary>
                  {action.cost && <p>コスト：{[...action.cost].map((cost) => `${cost}（${costNames[cost]}）`).join("＋")}</p>}
                  <p className="rule-text">正規効果：{action.effect}</p>
                  {action.target && <p>対象：{action.target}</p>}
                  {action.condition && <p>条件：{action.condition}</p>}
                  {action.triggerCondition && <p>起きる条件：{action.triggerCondition}</p>}
                  <p>@{action.trigger}-{action.speed}-{action.timing}</p>
                  <a href={action.href} target="_blank" rel="noreferrer">公式ルール ↗</a>
                </details>
              </article>
            ))}
          </section>
        ))}

        {tab === "characters" && (
          <section className="character-list">
            {characters.map(([id, character]) => (
              <article key={id} className="character-card">
                <div><h3>{character.name}</h3><span>{character.key}</span></div>
                <ul>{(characterNotes[id] || [character.type]).map((note) => <li key={note}>{note}</li>)}</ul>
                <details>
                  <summary>詳しく見る</summary>
                  <dl>
                    <dt>種類</dt><dd>{character.type}</dd>
                    <dt>できること</dt><dd>{character.labels}</dd>
                    {character.size && <><dt>数字</dt><dd>{character.size}</dd></>}
                    {character.ability && <><dt>能力</dt><dd>{character.ability}</dd></>}
                  </dl>
                  <a href={character.href} target="_blank" rel="noreferrer">公式ルール ↗</a>
                </details>
              </article>
            ))}
          </section>
        )}
        {tab === "actions" && !actions.length && <p>一致するアクションはありません。</p>}
        {tab === "characters" && !characters.length && <p>一致するキャラクターはありません。</p>}
      </div>
    </dialog>
  );
}
