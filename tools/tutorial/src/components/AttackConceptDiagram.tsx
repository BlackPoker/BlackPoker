import { PlayingCard } from "./PlayingCard";
import { ActionDefinition } from "./LessonExplainer";

export function AttackConceptDiagram() {
  return <figure className="attack-concept" aria-label="アタックは1ターンに1回。参加する兵士をまとめて指定し、相手プレイヤーを攻撃します。">
    <figcaption><h3>アタックとは？</h3><strong className="attack-limit">アタックは1ターンに1回</strong></figcaption>
    <p>そのアタックに参加する兵士をまとめて選ぶ。</p>
    <div className="attack-example-cards" aria-label="アタックできる兵士3体のうち2体だけを選ぶ例">
      {["S2", "C6", "H7"].map((code, index) => <div key={code} data-attacker={index < 2}>
        <PlayingCard code={code} state={index < 2 ? "drive" : "charge"} />
        <small>{index < 2 ? "✓ アタッカー" : "今回は選ばない"}</small>
      </div>)}
    </div>
    <div className="attack-join" aria-hidden="true"><span /></div>
    <div className="attack-player-flow"><strong>1回のアタックに参加</strong><span aria-hidden="true">↓</span><b>相手プレイヤー</b></div>
    <p className="attack-caption">選んだ兵士だけを横向きに。相手の兵士を攻撃対象に選ぶのではありません。</p>
    <details><summary>アタッカーにできる条件</summary><ActionDefinition id="attack" /></details>
    <p className="attack-practice-note">次は一番簡単な例。♠2だけでやってみましょう。</p>
  </figure>;
}
