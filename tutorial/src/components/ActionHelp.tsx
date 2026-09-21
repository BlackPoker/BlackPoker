import { useEffect, useRef, useState } from "react";
import { ruleCatalog } from "../generated/ruleCatalog";
const uses: Record<string, string> = {
  end: "行動を終えてターンを渡す",
  charge: "次のターンの場を準備する",
  draw: "次のターンの手札を補充する",
  attack: "兵士で攻撃する",
  block: "攻撃を防ぐ兵士や防壁を選ぶ",
  damageJudge: "攻撃と防御の結果を確認する",
  nextGeneration: "Aや絵札が場から墓地へ移ったとき",
  setBulwark: "守りや召喚に使う防壁を増やす",
  summonsSoldier: "数字カードを兵士にする",
  summonsHero: "絵札を兵士にする",
  summonsAce: "Aをすぐ攻撃できる兵士にする",
  mountSoldier: "同じスートのカードで兵士を強化する",
  up: "兵士の数字を上げたいとき",
  down: "兵士の数字を下げたいとき",
  twist: "カードの縦・横を変えたいとき",
  counter: "相手の行動を打ち消したいとき",
  destroyBulwark: "防壁を取り除きたいとき",
  throwing: "兵士を使わずダメージを与えたいとき",
  search: "Jokerでライフからカードを探す",
};
const costNames: Record<string, string> = {
  B: "縦向きの防壁1体を横に",
  L: "ライフの上1枚を墓地へ",
  D: "キーカードとは別に手札1枚を捨てる",
  S: "キャラクター1体を墓地へ",
  C: "対象のキャラクターを横に",
};
export function ActionHelp({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialog.current?.showModal) dialog.current.showModal();
    else dialog.current?.setAttribute("open", "");
  }, []);
  const actions = Object.entries(ruleCatalog.actions).filter(
    ([, a]) =>
      (a.formats as readonly string[]).includes("lite") &&
      (a.name + a.group + a.key).includes(query),
  );
  return (
    <dialog
      className="action-help"
      ref={dialog}
      onCancel={onClose}
      aria-labelledby="help-title"
    >
      <header>
        <div>
          <small>対戦中も、ここを見ながら</small>
          <h2 id="help-title">アクション早見</h2>
        </div>
        <button onClick={onClose} aria-label="早見を閉じる">
          ×
        </button>
      </header>
      <div className="help-scroll">
        <details>
          <summary>1戦の進め方・困ったとき</summary>
          <p>
            先攻の1枚ドロー後、できるアクションを選びます。使うカードとコストを確かめ、宣言してから操作してください。相手が対応するかも確認します。
          </p>
          <p>
            終わるときはエンド → 次のプレイヤーがチャージ →
            ドロー。ライフがなくなったプレイヤーが敗北します。
          </p>
          <p>
            ブロックは指定だけで、横向きにはしません。召喚したターンは、速攻がない兵士では攻撃できません。
          </p>
          <p>
            アクションの応酬で迷ったら、
            <a
              href="https://blackpoker.github.io/BlackPoker/master/common/common-action.html"
              target="_blank"
              rel="noreferrer"
            >
              公式のアクション手順 ↗
            </a>
            を2人で確認してください。
          </p>
        </details>
        <label className="help-search">
          アクション名・カードで探す
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例：召喚、ツイスト"
          />
        </label>
        <p className="help-note">
          ライトで使える
          {
            Object.values(ruleCatalog.actions).filter((a) =>
              (a.formats as readonly string[]).includes("lite"),
            ).length
          }
          種類。覚える必要はありません。キーカードとコストは別に用意します。
        </p>
        {actions.map(([id, a]) => (
          <article key={id} className="help-action">
            <h3>{a.name}</h3>
            <p>{uses[id] || a.group}</p>
            {id === "search" && (
              <p className="help-note">
                エントリー16にはJokerが入らないため使えません。
              </p>
            )}
            <dl>
              <dt>必要なカード</dt>
              <dd>
                {a.key ||
                  (id === "setBulwark"
                    ? "手札から1枚（種類は自由）"
                    : "指定なし（詳細の条件を確認）")}
              </dd>
              <dt>コスト</dt>
              <dd>
                {a.cost
                  ? [...a.cost].map((c) => costNames[c] || c).join(" ＋ ")
                  : "追加コストなし"}
              </dd>
            </dl>
            <details>
              <summary>効果・条件を確認</summary>
              <p className="rule-text">{a.effect}</p>
              {a.target && <p>対象：{a.target}</p>}
              {a.condition && <p>{a.condition}</p>}
              {a.triggerCondition && <p>{a.triggerCondition}</p>}
              <p>
                {a.trigger} / {a.timing} / {a.speed}
              </p>
              <a href={a.href} target="_blank" rel="noreferrer">
                公式ルール ↗
              </a>
            </details>
          </article>
        ))}
        {!actions.length && <p>一致するアクションはありません。</p>}
      </div>
    </dialog>
  );
}
