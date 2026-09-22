const costs = [
  ["B", "防壁をドライブする"],
  ["L", "1点ダメージを受ける"],
  ["D", "手札を1枚捨てる"],
] as const;

export function BeginnerGuide() {
  return (
    <section className="beginner-guide" aria-labelledby="guide-title">
      <div className="guide-heading">
        <div>
          <small>BEGINNER GUIDE</small>
          <h3 id="guide-title">早見の読み方</h3>
        </div>
        <span>必要なところだけ開く</span>
      </div>
      <p>
        アクションは、ゲーム中に起こす「行動」です。名前を伝え、必要ならコスト・キーカード・対象を選びます。
      </p>
      <div className="notation-grid">
        <p><b>@</b><span>いつ・どう解決するか</span></p>
        <p><b>$</b><span>支払うコスト</span></p>
        <p><b>★</b><span>使うカード／ユニット</span></p>
      </div>
      <details>
        <summary>通常効果・即時効果と自動アクション</summary>
        <p>
          通常は相手が割り込む機会を持ち、全員が待ったあとに解決します。即時はその場ですぐ解決し、割り込めません。
        </p>
        <div className="auto-flow">
          <span>エンド</span><i>→</i><span>チャージ</span><i>→</i><span>ドロー</span>
        </div>
        <div className="auto-flow">
          <span>アタック</span><i>→</i><span>ブロック</span><i>→</i><span>ダメージ判定</span>
        </div>
        <p>後ろのアクションは条件を満たすと自動的に起きます。</p>
      </details>
      <div className="cost-primer">
        <strong>まず覚える3つのコスト</strong>
        <div>
          {costs.map(([key, text]) => (
            <p key={key}><b>{key}</b><span>{text}</span></p>
          ))}
        </div>
        <details>
          <summary>C / S も確認する</summary>
          <p><b>C</b>：キーユニットのキャラクターをドライブする</p>
          <p><b>S</b>：キャラクター1体を墓地に移す</p>
        </details>
      </div>
      <details>
        <summary>防壁設置・兵士召喚</summary>
        <p><b>防壁設置</b>は1ターンに1回。Lを支払い、手札1枚を裏向き・チャージ状態で置きます。防壁はライフ側へ詰め、左右を入れ替えません。</p>
        <p><b>兵士召喚</b>は2〜10を使い、BLを支払って表向き・チャージ状態で出します。縦向きがチャージ、横向きがドライブ。通常の兵士は出したターンには攻撃できません。</p>
      </details>
      <details>
        <summary>エンド・チャージ・ドロー</summary>
        <p>エンドで相手へターンが渡ると、次のプレイヤーのチャージ、ドローが順に自動で起きます。自分で直接起こす操作ではありません。</p>
        <p>現行ルールのドローは通常2枚。ライフが2枚以下なら1枚です。</p>
      </details>
      <details>
        <summary>アタック・ブロック・ダメージ判定</summary>
        <p>アタックは1ターンに1回。チャージ状態で、このターンより前から場にいる攻撃可能な兵士を選びます。</p>
        <p>兵士または防壁でブロックできます。兵士同士は数字を比べ、防壁は公開して条件を確認します。ブロックされなければ、兵士の数字ぶんライフへダメージを与えます。</p>
      </details>
      <details>
        <summary>番外編：アップ・ダウンとクイック</summary>
        <p>アップ／ダウンは兵士の数字を一時的に上げ下げする魔法です。クイックは相手の行動中にも起こせるタイミング。通常効果なら、相手のアクションへ割り込んで積み、後から積んだものから解決します。</p>
      </details>
    </section>
  );
}
