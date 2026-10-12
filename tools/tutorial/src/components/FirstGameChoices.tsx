import { RuleLinks } from "./RuleLinks";

/** 最初の対戦が第1ゴール。応用教材へは本人が選んだときだけ進む。 */
export function FirstGameChoices({ afterGame = false, onSelect, onHelp }: {
  afterGame?: boolean; onSelect: (id: string) => void; onHelp: () => void;
}) {
  return <div className="first-game-choices" id={afterGame ? "after-game" : undefined}>
    {afterGame ? <><h3 tabIndex={-1}>基本の対戦準備ができました</h3><p>まずは2人で1ゲーム。遊びながら、気になったことを調べられます。</p></>
      : <p>次は実物のトランプを使ってみましょう。</p>}
    <button className="primary-button" onClick={() => onSelect(afterGame ? "about" : "entry16")}>
      {afterGame ? "もう一度基本を確認" : "実物カードで遊ぶ →"}
    </button>
    <div className="choice-secondary">
      <button onClick={() => onSelect("bulwark")}>もう少しルールを覚える</button>
      {afterGame && <><button onClick={() => onSelect("up")}>魔法を覚える <small>準備中</small></button>
        <button onClick={() => onSelect("chance")}>割込みを覚える <small>準備中</small></button></>}
      <button onClick={onHelp}>ルール早見を見る</button>
    </div>
    {afterGame && <RuleLinks refs={["frame.entry16"]} />}
  </div>;
}
