const costs = [
  { key: "B", from: "防壁（縦）", move: "横向きにする", term: "防壁をドライブ" },
  { key: "L", from: "ライフの上1枚", move: "墓地へ", term: "1点ダメージを受ける" },
  { key: "D", from: "手札1枚", move: "墓地へ", term: "手札を1枚捨てる" },
] as const;

export function BeginnerGuide() {
  return (
    <section className="beginner-guide" aria-labelledby="guide-title">
      <div className="guide-heading">
        <div><small>BEGINNER GUIDE</small><h3 id="guide-title">アクションの読み方</h3></div>
        <span>必要なところだけ開く</span>
      </div>
      <p><b>行動すること</b>を、BlackPokerでは「アクション」と呼びます。名前を伝え、使うために必要なもの（コスト）を払ってから、カードを動かします。</p>
      <div className="notation-grid">
        <p><b>@</b><span>いつ使い、どう進むか</span></p>
        <p><b>$</b><span>使うために払うもの</span></p>
        <p><b>★</b><span>中心になるカード／キャラクター</span></p>
      </div>
      <div className="cost-primer">
        <strong>カードの動きで覚える B / L / D</strong>
        <div className="cost-moves">
          {costs.map((cost) => (
            <article key={cost.key}>
              <b>{cost.key}</b>
              <span>{cost.from}</span><i>→</i><span>{cost.move}</span>
              <small>{cost.term}</small>
            </article>
          ))}
        </div>
        <details>
          <summary>C / S も確認する</summary>
          <p><b>C</b>：キーユニットのキャラクターをドライブする</p>
          <p><b>S</b>：キャラクター1体を場から墓地へ移す</p>
        </details>
      </div>
      <details>
        <summary>メイン / クイック、通常 / 即時の違い</summary>
        <dl className="term-list">
          <dt>メイン</dt><dd>基本的に自分のターンに使うタイミング</dd>
          <dt>クイック</dt><dd>相手の行動中にも使えるタイミング</dd>
          <dt>通常</dt><dd>ステージという待機場所を通り、相手がクイックで対応できる</dd>
          <dt>即時</dt><dd>ステージを通らず、その場ですぐ終わる。相手は割り込めない</dd>
          <dt>誘発</dt><dd>決まった出来事をきっかけに、自動で起きる</dd>
          <dt>解決</dt><dd>アクションに書かれた効果を実際に行うこと</dd>
        </dl>
      </details>
      <details>
        <summary>自動で続くアクション</summary>
        <div className="auto-flow"><span>エンド</span><i>→</i><span>チャージ</span><i>→</i><span>ドロー</span></div>
        <div className="auto-flow"><span>アタック</span><i>→</i><span>ブロック</span><i>→</i><span>ダメージ判定</span></div>
        <p>後ろのアクションは、条件を満たすと自動で起きます。</p>
      </details>
    </section>
  );
}
