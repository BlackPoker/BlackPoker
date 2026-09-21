// act.yaml / frame.yamlから生成。直接編集しないでください。
export const ruleCatalog = {
  "actions": {
    "end": {
      "name": "エンド",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-end",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "基本",
      "key": "",
      "cost": "",
      "effect": "1. 手札が7枚を越えた場合、7枚になるよう手札を捨てる。\n2. すべてのフォグにあるカードを全て墓地に移す。\n3. 自分のターンを終了し、対戦相手にターンを渡す。",
      "target": "",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "通常"
    },
    "charge": {
      "name": "チャージ",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-charge",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "基本",
      "key": "",
      "cost": "",
      "effect": "ターンを持っているプレイヤーの場にいるキャラクターを全てチャージ状態にする。",
      "target": "",
      "condition": "",
      "trigger": "誘発",
      "triggerCondition": "ターンプレイヤーであり、かつ、エンドアクションが解決した時に誘発する。",
      "timing": "メイン",
      "speed": "即時"
    },
    "draw": {
      "name": "ドロー",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-draw",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "基本",
      "key": "",
      "cost": "",
      "effect": "ライフの一番上からカードを2枚引き、手札に加える。\nただし、ライフが2以下の場合はカードを1枚引き、手札に加える。",
      "target": "",
      "condition": "",
      "trigger": "誘発",
      "triggerCondition": "ターンプレイヤーであり、かつ、チャージアクションが解決した時に誘発する。",
      "timing": "メイン",
      "speed": "通常"
    },
    "attack": {
      "name": "アタック",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-attack",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "基本",
      "key": "",
      "cost": "",
      "effect": "対戦相手を攻撃するアタッカーをドライブして指定する。\n・アタッカーは <攻撃> を持っているキャラクターを指定できる。\n・アタッカーは複数指定可能。ドライブ状態のキャラクターは指定できない。\n・このターン場に出たキャラクターは指定できない、ただし <速攻> があるキャラクターは指定できる。",
      "target": "",
      "condition": "プレイヤーは、1ターンに1回までこのアクションを起こすことができる。",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "通常"
    },
    "block": {
      "name": "ブロック",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-block",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "基本",
      "key": "",
      "cost": "",
      "effect": "対戦相手はアタックアクションにて指定されたアタッカー毎にそれをブロックするキャラクター(ブロッカー)を指定する。\n・ブロッカーは <防御> を持っているキャラクターを指定できる。 \n・兵士でブロックする場合、1アタッカーに対して複数の兵士を指定できる。ドライブ状態のキャラクターは指定できない。",
      "target": "",
      "condition": "",
      "trigger": "誘発",
      "triggerCondition": "ターンプレイヤーであり、かつ、アタックアクションが解決した時にアタッカーが1体以上いる場合、誘発する。",
      "timing": "メイン",
      "speed": "通常"
    },
    "damageJudge": {
      "name": "ダメージ判定",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-damagejudge",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "基本",
      "key": "",
      "cost": "",
      "effect": "アタッカーとブロッカーを比較する\n1. 兵士(アタッカー)と兵士(ブロッカー)の場合、アタッカーとブロッカーの数字を比較し、小さい方を墓地に移す。数字が同じ場合は両方を墓地に移す。1体のアタッカーに対して複数のブロッカーがいる場合、ブロッカーの合計数字と比較する。\n2. 兵士(アタッカー)と防壁(ブロッカー)の場合、次を行う。\n-1. 防壁を表にし、防壁が次の条件に当てはまる場合、アタッカーを墓地に移す。\n--A. 防壁がJokerの場合\n--B. 防壁のカードに記載されている数字と同じ数字がアタッカーのカードに含まれている場合\n-2. 防壁を墓地に移す。\n3. アタッカーをブロックするブロッカーが場に存在しない場合、アタッカーの数字だけ対戦相手にダメージを与える。",
      "target": "",
      "condition": "",
      "trigger": "誘発",
      "triggerCondition": "ターンプレイヤーであり、かつ、ブロックアクションが解決した時に誘発する。",
      "timing": "メイン",
      "speed": "通常"
    },
    "nextGeneration": {
      "name": "世代交代",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-nextgeneration",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "基本",
      "key": "",
      "cost": "",
      "effect": "ライフの一番上からJoker,A,J,Q,Kのいずれかが出るまで墓地にカードを移動し、出たら手札に加える。",
      "target": "",
      "condition": "",
      "trigger": "誘発",
      "triggerCondition": "Joker,A,J,Q,Kのカードが自分の場から墓地に移るたびに1枚につき1回誘発する。",
      "timing": "クイック",
      "speed": "即時"
    },
    "setBulwark": {
      "name": "防壁設置",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-setbulwark",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "召喚",
      "key": "",
      "cost": "L",
      "effect": "手札からカード1枚を防壁として裏向きかつチャージ状態で場に出す。防壁の置き方は「防壁の置き方」参照。",
      "target": "",
      "condition": "プレイヤーは、1ターンに1回までこのアクションを起こすことができる。",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "即時"
    },
    "summonsSoldier": {
      "name": "兵士召喚",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-summonssoldier",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "召喚",
      "key": "2〜10",
      "cost": "BL",
      "effect": "キーカードを一般兵として表向きかつチャージ状態で場に出す。",
      "target": "",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "通常"
    },
    "summonsHero": {
      "name": "英雄召喚",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-summonshero",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "召喚",
      "key": "J〜K",
      "cost": "BBL",
      "effect": "キーカードを英雄として表向きかつチャージ状態で場に出す。",
      "target": "",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "通常"
    },
    "summonsAce": {
      "name": "エース召喚",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-summonsace",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "召喚",
      "key": "A",
      "cost": "L",
      "effect": "キーカードをエースとして表向きかつチャージ状態で場に出す。",
      "target": "",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "通常"
    },
    "quickSummonsAce": {
      "name": "クイック召喚",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-quicksummonsace",
      "formats": [
        "pro",
        "mast"
      ],
      "group": "召喚",
      "key": "A",
      "cost": "D",
      "effect": "キーカードをエースとして表向きかつチャージ状態で場に出す。\nもしくは、キーカードを防壁として裏向きかつチャージ状態で場に出す。\n防壁の置き方は「防壁の置き方」参照。",
      "target": "",
      "condition": "ターンを持っていない時しかこのアクションを起こすことができない。",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "クイック",
      "speed": "通常"
    },
    "summonsMagic": {
      "name": "魔術士召喚",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-summonsmagic",
      "formats": [
        "std",
        "pro",
        "mast"
      ],
      "group": "召喚",
      "key": "Joker",
      "cost": "BD",
      "effect": "キーカードを魔術士として表向きかつチャージ状態で場に出す。魔術士の能力は、キャラクターリスト参照。",
      "target": "",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "通常"
    },
    "mountSoldier": {
      "name": "装備",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-mountsoldier",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "召喚",
      "key": "A〜K",
      "cost": "BL",
      "effect": "対象とした兵士の上にキーカードを置き装備兵とする。装備兵の能力は、キャラクターリスト参照。",
      "target": "キーカードとスートが等しい自分の兵士1体",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "通常"
    },
    "up": {
      "name": "アップ",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-up",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "基礎魔法",
      "key": "♡A〜10",
      "cost": "D",
      "effect": "対象とした兵士のサイズは、このターンが終わるまでキーカードの数字分加算される。その印としてフォグにキーカードを置き、アップとする。",
      "target": "兵士1体",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "クイック",
      "speed": "通常"
    },
    "down": {
      "name": "ダウン",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-down",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "基礎魔法",
      "key": "♠A〜10",
      "cost": "D",
      "effect": "対象とした兵士のサイズは、このターンが終わるまでキーカードの数字分減算される。\nもし対象のサイズが0以下となった場合、対象を墓地に移す。\nもし対象のサイズが0以下とならなかった場合、その印としてフォグにキーカードを置き、ダウンとする。",
      "target": "兵士1体",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "クイック",
      "speed": "通常"
    },
    "twist": {
      "name": "ツイスト",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-twist",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "基礎魔法",
      "key": "♢A〜10",
      "cost": "D",
      "effect": "対象のキャラクターをドライブ状態またはチャージ状態にする。",
      "target": "キャラクター1体",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "クイック",
      "speed": "通常"
    },
    "counter": {
      "name": "カウンター",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-counter",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "基礎魔法",
      "key": "♣A〜10",
      "cost": "D",
      "effect": "次のいずれかの場合、対象のリクエストを無効にする。その場合、対象リクエストをステージから取り除き、対象リクエストのキーカードを墓地に移す。\n・対象リクエストのキーカードが1枚かつこのリクエストのキーカードの数字が対象リクエストのキーカードの数字以上\n・対象リクエストのキーカードが2枚",
      "target": "キーカードが1枚または2枚のリクエスト",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "クイック",
      "speed": "通常"
    },
    "destroyBulwark": {
      "name": "防壁破壊",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-destroybulwark",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "中級魔法",
      "key": "♡A〜K と ♢A〜K",
      "cost": "",
      "effect": "対象の防壁を場から墓地に移す。",
      "target": "防壁1体",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "通常"
    },
    "throwing": {
      "name": "投擲",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-throwing",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "中級魔法",
      "key": "♠A〜K と ♣A〜K",
      "cost": "",
      "effect": "対象の対戦相手にX点のダメージを与える。Xはキーカードの♠カードの数字に等しい。",
      "target": "対戦相手1人",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "通常"
    },
    "deathLance": {
      "name": "死の槍",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-deathlance",
      "formats": [
        "std",
        "pro",
        "mast"
      ],
      "group": "中級魔法",
      "key": "♠A〜K と ♢A〜K",
      "cost": "",
      "effect": "対象の兵士のサイズが0以外であり、かつ、キーカードの♢カードの数字で割り切れる場合、次を行う。\n1. 対象の兵士をオーナーのライフの一番上に裏向きで移す。兵士が複数のカードから成る場合、任意の順でライフの一番上に裏向きで移す。\n2. 対象の兵士のオーナーにX点のダメージを与える。Xはキーカードの♠カードの数字に等しい。",
      "target": "兵士1体",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "通常"
    },
    "addBulwark": {
      "name": "防壁補充",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-addbulwark",
      "formats": [
        "std",
        "pro",
        "mast"
      ],
      "group": "中級魔法",
      "key": "♡A〜K と ♣A〜K",
      "cost": "",
      "effect": "自分のライフの一番上から1枚を防壁として裏向きかつチャージ状態で場に出す。もしくは、自分のライフの一番上から2枚を防壁として裏向きかつドライブ状態で場に出す。防壁の能力はキャラクターリスト参照。\n防壁の置き方は「防壁の置き方」参照",
      "target": "",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "通常"
    },
    "reanimate": {
      "name": "リアニメイト",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-reanimate",
      "formats": [
        "std",
        "pro",
        "mast"
      ],
      "group": "中級魔法",
      "key": "♠A〜K と ♡A〜K",
      "cost": "",
      "effect": "自分の墓地にあるカード1枚を選ぶ。対象のキャラクターを墓地に移せた場合、選んだカードを兵士として表向きかつチャージ状態で場に出す。移せない場合、選んだカードを墓地に戻す。",
      "target": "自分のキャラクター1体",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "通常"
    },
    "handeth": {
      "name": "ハンデス",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-handeth",
      "formats": [
        "std",
        "pro",
        "mast"
      ],
      "group": "中級魔法",
      "key": "♢A〜K と ♣A〜K",
      "cost": "",
      "effect": "対戦相手の手札を見て1枚カードを指定する。対戦相手は指定されたカードを手札から捨てる。",
      "target": "対戦相手1人",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "通常"
    },
    "kill": {
      "name": "キル",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-kill",
      "formats": [
        "pro",
        "mast"
      ],
      "group": "中級魔法",
      "key": "♠A〜10 を 2枚",
      "cost": "",
      "effect": "対象とした兵士を墓地に移す。",
      "target": "兵士1体",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "クイック",
      "speed": "通常"
    },
    "reunion": {
      "name": "再会",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-reunion",
      "formats": [
        "pro",
        "mast"
      ],
      "group": "中級魔法",
      "key": "♡A〜10 を 2枚",
      "cost": "",
      "effect": "自分の墓地からカードを1枚選び対戦相手に見せ手札に加える。",
      "target": "",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "クイック",
      "speed": "通常"
    },
    "truce": {
      "name": "停戦",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-truce",
      "formats": [
        "pro",
        "mast"
      ],
      "group": "中級魔法",
      "key": "♢A〜10 を 2枚",
      "cost": "",
      "effect": "対象のリクエストを無効にし、対象のリクエストをステージから取り除く。",
      "target": "ダメージ判定アクションのリクエスト",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "クイック",
      "speed": "通常"
    },
    "changeTarget": {
      "name": "対象変更",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-changetarget",
      "formats": [
        "pro",
        "mast"
      ],
      "group": "中級魔法",
      "key": "♣A〜10 を 2枚",
      "cost": "",
      "effect": "対象のリクエストで指定されている対象をそのアクションが指定できる範囲で変更する。リクエストの対象を対象変更に変更することは可能、アクションの対象にできないものへの対象の変更は不可能とする。",
      "target": "対象が指定されているリクエスト",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "クイック",
      "speed": "通常"
    },
    "search": {
      "name": "サーチ",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-search",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "group": "中級魔法",
      "key": "Joker",
      "cost": "",
      "effect": "ライフから好きなカードを1枚選び対戦相手に見せ手札に加える。その後ライフをシャッフルする。",
      "target": "",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "クイック",
      "speed": "即時"
    },
    "reverse": {
      "name": "リバース",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-reverse",
      "formats": [
        "pro",
        "mast"
      ],
      "group": "中級魔法",
      "key": "同じ数字を2枚",
      "cost": "",
      "effect": "1. 必要であれば、対象のキャラクターをチャージ状態またはドライブ状態にする。\n2. 対象が兵士の場合、兵士を防壁にする。兵士の時に受けた効果、能力は無くなる。兵士が複数のカードから成る場合、1枚ずつ防壁にする。防壁の置き方は「防壁の置き方」参照\n3. 対象が防壁の場合、防壁を兵士にする。防壁の時に受けた効果、能力は無くなる。このターンに場に出た防壁を兵士にする場合、その兵士はこのターンに出た兵士と同様に扱う。\n4. 対象がアタッカーもしくは、ブロッカーの場合、それを解除する。",
      "target": "キャラクター1体",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "クイック",
      "speed": "通常"
    },
    "unsummons": {
      "name": "帰還",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-unsummons",
      "formats": [
        "std",
        "pro",
        "mast"
      ],
      "group": "中級魔法",
      "key": "同じスートを2枚",
      "cost": "B",
      "effect": "1. 対象のキャラクターがチャージ状態の場合、対象のキャラクターを手札に戻す。\n2. キーカードを手札に戻す。",
      "target": "自分のキャラクター1体",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "クイック",
      "speed": "通常"
    },
    "swordRain": {
      "name": "剣の雨",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-swordrain",
      "formats": [
        "mast"
      ],
      "group": "上級魔法",
      "key": "♠A〜10 を 2枚",
      "cost": "BB",
      "effect": "サイズがキーカードの合計値以下の全ての兵士を墓地に移す。",
      "target": "",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "通常"
    },
    "force": {
      "name": "フォース",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-force",
      "formats": [
        "mast"
      ],
      "group": "上級魔法",
      "key": "♡A〜10 を 2枚",
      "cost": "BB",
      "effect": "このターンが終わるまで自分の兵士全ての数字は、キーカードの合計値分加算される。\nその印としてフォグにキーカードを置き、フォースとする。",
      "target": "",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "通常"
    },
    "recruit": {
      "name": "徴募",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-recruit",
      "formats": [
        "mast"
      ],
      "group": "上級魔法",
      "key": "♢A〜10 を 2枚",
      "cost": "BB",
      "effect": "1. ライフの一番上から4枚めくり、キーカードの合計値以下のカードを兵士としてドライブ状態で場に出す。\n2. 残りのカードをライフの一番下に好きな順で移す。",
      "target": "",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "通常"
    },
    "surprise": {
      "name": "奇襲",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-surprise",
      "formats": [
        "mast"
      ],
      "group": "上級魔法",
      "key": "♣A〜10 を 2枚",
      "cost": "BB",
      "effect": "1. 自分の場にいる防壁を全て兵士にする。このターンに場に出た防壁を兵士にする場合、その兵士はこのターンに出た兵士と同様に扱う。\n2. 自分の場にいる全ての兵士をチャージ状態にする。",
      "target": "",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "メイン",
      "speed": "通常"
    },
    "bj": {
      "name": "B・J",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-bj",
      "formats": [
        "mast"
      ],
      "group": "上級魔法",
      "key": "A と J",
      "cost": "",
      "effect": "1. 合計点 を 0 とし、自分のライフの山札から1枚めくり表向きにする。公開したカードをまとめて 公開カード と呼ぶ。\n2. めくったカードの点数を合計点に加える。  \n-・A は 11 点として扱う。ただし合計点が 22 点以上になる場合は 1 点として扱う。  \n-・J,Q,K は 10 点、Joker は 0 点、2〜10 は数字どおりとして扱う。\n3. 合計点が 22 点以上になった場合、公開カードをすべて墓地に置き、効果を終了する。\n4. 合計点が 21 点以下の場合、ヒット もしくは、スタンドを行う。\n-・ヒット: さらに 1 枚めくり、手順 2 に戻る。  \n-・スタンド: 公開カードすべてを手札に加え、効果を終了する。",
      "target": "",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "クイック",
      "speed": "通常"
    },
    "rsf": {
      "name": "R・S・F",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#act-rsf",
      "formats": [
        "mast"
      ],
      "group": "上級魔法",
      "key": "同じスートのA,10〜K を 5枚",
      "cost": "BB",
      "effect": "対象のプレイヤーに40点のダメージを与える。",
      "target": "プレイヤー1人",
      "condition": "",
      "trigger": "直接",
      "triggerCondition": "",
      "timing": "クイック",
      "speed": "通常"
    }
  },
  "characters": {
    "soldier": {
      "name": "一般兵",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#char-soldier",
      "key": "2〜10",
      "type": "兵士",
      "labels": "攻撃, 防御",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "size": "ユニットカードの数字",
      "ability": ""
    },
    "hero": {
      "name": "英雄",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#char-hero",
      "key": "J〜K",
      "type": "兵士",
      "labels": "攻撃, 防御",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "size": "ユニットカードがJなら11,Qなら12,Kなら13",
      "ability": ""
    },
    "ace": {
      "name": "エース",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#char-ace",
      "key": "A",
      "type": "兵士",
      "labels": "攻撃, 防御, 速攻",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "size": "1",
      "ability": ""
    },
    "magician": {
      "name": "魔術士",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#char-magician",
      "key": "Joker",
      "type": "兵士",
      "labels": "攻撃, 防御, 速攻",
      "formats": [
        "std",
        "pro",
        "mast"
      ],
      "size": "0",
      "ability": "・魔力増加(このキャラクターが場にいる間、タイプが「魔法」かつ、タイミングが「クイック」のアクションのコストDを無しとする。)"
    },
    "armedsoldier": {
      "name": "装備兵",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#char-armedsoldier",
      "key": "同じスートを2枚以上",
      "type": "兵士",
      "labels": "攻撃, 防御, 速攻(キーカードにAが含まれる場合のみ)",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "size": "ユニットカードの数字の合計",
      "ability": ""
    },
    "bulwark": {
      "name": "防壁",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#char-bulwark",
      "key": "全て(裏向き)",
      "type": "防壁",
      "labels": "防御",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ],
      "size": "",
      "ability": ""
    }
  },
  "fogs": {
    "upFog": {
      "name": "アップ",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#fog-upfog",
      "key": "♡A〜10",
      "effect": "対象とした兵士のサイズは、このターンが終わるまでキーカードの数字分加算される。",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ]
    },
    "downFog": {
      "name": "ダウン",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#fog-downfog",
      "key": "♠A〜10",
      "effect": "対象とした兵士のサイズは、このターンが終わるまでキーカードの数字分減算される。",
      "formats": [
        "lite",
        "std",
        "pro",
        "mast"
      ]
    },
    "forceFog": {
      "name": "フォース",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html#fog-forcefog",
      "key": "♡A〜10 を 2枚",
      "effect": "このターンが終わるまで自分の兵士全ての数字は、キーカードの合計値分加算される。",
      "formats": [
        "mast"
      ]
    }
  },
  "frames": {
    "entry16": {
      "name": "エントリー16",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/framelist.html#frame-entry16",
      "deck": "次のカードのみで構成された16枚のデッキを使う\n* ♠A, 2, 3, K\n* ♡4, 7, J, Q\n* ♢5, 8, 10, Q\n* ♣A, 6, 9, K",
      "start": "#. デッキをシャッフルする。\n#. デッキをライフとし、配置図の場所に伏せておく。\n#. ライフの一番上のカード7枚引き手札とする。\n#. :numref:`common_gamestart_preset` に従ってプリセットする。\n#. :numref:`common_gamestart_first` に従って先攻プレイヤーを決定する。\n#. :numref:`common_gamestart_start` に従ってゲームを開始する。",
      "formats": [
        "lite"
      ]
    },
    "pack": {
      "name": "パック",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/framelist.html#frame-pack",
      "deck": "40枚以上",
      "start": "#. デッキをシャッフルする。\n#. デッキの上から14枚を取り除いてパックとし、配置図の場所に伏せておく。\n#. 残りのデッキをライフとし配置図の場所に伏せておく。\n#. ライフの一番上のカード7枚引き手札とする。\n#. :numref:`common_gamestart_preset` に従ってプリセットする。\n#. :numref:`common_gamestart_first` に従って先攻プレイヤーを決定する。\n#. :numref:`common_gamestart_start` に従ってゲームを開始する。",
      "formats": [
        "lite",
        "std"
      ]
    },
    "rarePack": {
      "name": "レアパック",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/framelist.html#frame-rarepack",
      "deck": "40枚以上",
      "start": "#. デッキからレアカード1枚を選び配置図の場所に伏せておく。\n#. デッキをシャッフルする。\n#. デッキの上から14枚を取り除いてパックとし、配置図の場所に伏せておく。\n#. 残りのデッキをライフとし配置図の場所に伏せておく。\n#. ライフの一番上のカード7枚引き手札とする。\n#. :numref:`common_gamestart_preset` に従ってプリセットする。\n#. :numref:`common_gamestart_first` に従って先攻プレイヤーを決定する。\n#. :numref:`common_gamestart_start` に従ってゲームを開始する。",
      "formats": [
        "std",
        "pro"
      ]
    },
    "strategy": {
      "name": "ストラテジー",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/framelist.html#frame-strategy",
      "deck": "40枚以上",
      "start": "#. デッキから最初の手札に入れる3枚を選ぶ。(シナリオ手札)\n#. デッキからレアカード1枚を選び配置図の場所に伏せておく。\n#. デッキをシャッフルする。\n#. デッキの上から14枚を取り除いてパックとし、配置図の場所に伏せておく。\n#. 残りのデッキをライフとし配置図の場所に伏せておく。\n#. ライフの一番上のカードを4枚引いて手札を7枚とする。\n#. :numref:`common_gamestart_preset` に従ってプリセットする。\n#. :numref:`common_gamestart_first` に従って先攻プレイヤーを決定する。\n#. :numref:`common_gamestart_start` に従ってゲームを開始する。",
      "formats": [
        "pro",
        "mast"
      ]
    },
    "extra": {
      "name": "エクストラ",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/framelist.html#frame-extra",
      "deck": "40枚以上",
      "start": "#. デッキから2枚を切札として選び、2枚とも配置図の切札の場所に伏せておく。\n#. デッキから最初の手札に入れる3枚を選ぶ。(シナリオ手札)\n#. デッキからレアカード1枚を選び配置図の場所に伏せておく。\n#. 残りのデッキをシャッフルし、上から14枚を取り除いてパックとし、配置図の場所に伏せておく。\n#. 残りのデッキをライフとし配置図の場所に伏せておく。\n#. ライフの一番上のカードを4枚引いて手札を7枚とする。\n#. ライフの一番上のカードを防壁として場に出し、次のカードを兵士の場所に裏向きで出す。(プリセット)\n#. 対戦相手も手札を7枚用意でき、準備ができてから :numref:`common_gamestart_first` に従って先攻プレイヤーを決定する。\n#. 先攻プレイヤーは、プリセットで兵士の場所に裏向きで出したカードを表にし、切札の場所の2枚のうち1枚を表向きにする。\n#. 後攻プレイヤーも、プリセットで兵士の場所に裏向きで出したカードを表にし、切札の場所の2枚のうち1枚を表向きにする。      \n#. :numref:`common_gamestart_start` に従ってゲームを開始する。",
      "formats": [
        "mast"
      ]
    },
    "draft": {
      "name": "ドラフト",
      "href": "https://blackpoker.github.io/BlackPoker/master/auto/framelist.html#frame-draft",
      "deck": "40枚以上",
      "start": "#. デッキをシャッフルし、上から3枚ずつ取って6個のミニパック(裏向きの3枚)を作成する。\n#. 1つ目のミニパックを見て1枚を選択し裏向きに脇に置き、残りの2枚を裏向きに元の位置に戻す。\n#. 2つ目から6つ目のミニパックも同様に1枚を選択して脇に置き、残りを元の位置に戻す。(合計6枚のカードを脇に置く)\n#. 脇に置いた6枚のカードを、レアカード1枚、切札2枚、シナリオ手札(最初の手札に入れるカード)3枚に分ける。\n#. ミニパックの残りのカード12枚と残りのデッキを混ぜてシャッフルする。\n#. 分けた2枚を切札とし、2枚とも配置図の切札の場所に伏せておく。\n#. 分けた3枚をシナリオ手札(最初の手札に入れるカード)とする。\n#. 分けたレアカード1枚を配置図の場所に伏せておく。\n#. 残りのデッキの上から14枚を取り除いてパックとし、配置図の場所に伏せておく。\n#. 残りのデッキをライフとし配置図の場所に伏せておく。\n#. ライフの一番上のカードを4枚引いて手札を7枚とする。(シナリオ手札の3枚と合わせて手札は7枚になる)\n#. ライフの一番上のカードを防壁として場に出し、次のカードを兵士の場所に裏向きで出す。(プリセット)\n#. 対戦相手も手札を7枚用意でき、準備ができてから :numref:`common_gamestart_first` に従って先攻プレイヤーを決定する。\n#. 先攻プレイヤーは、プリセットで兵士の場所に裏向きで出したカードを表にし、切札の場所の2枚のうち1枚を表向きにする。\n#. 後攻プレイヤーも、プリセットで兵士の場所に裏向きで出したカードを表にし、切札の場所の2枚のうち1枚を表向きにする。\n#. :numref:`common_gamestart_start` に従ってゲームを開始する。",
      "formats": [
        "mast"
      ]
    }
  },
  "formats": {
    "lite": {
      "name": "ライト",
      "href": "https://blackpoker.github.io/BlackPoker/master/format/format.html",
      "actions": [
        "end",
        "charge",
        "draw",
        "attack",
        "block",
        "damageJudge",
        "nextGeneration",
        "setBulwark",
        "summonsSoldier",
        "summonsHero",
        "summonsAce",
        "mountSoldier",
        "up",
        "down",
        "twist",
        "counter",
        "destroyBulwark",
        "throwing",
        "search"
      ]
    },
    "std": {
      "name": "スタンダード",
      "href": "https://blackpoker.github.io/BlackPoker/master/format/format.html",
      "actions": [
        "end",
        "charge",
        "draw",
        "attack",
        "block",
        "damageJudge",
        "nextGeneration",
        "setBulwark",
        "summonsSoldier",
        "summonsHero",
        "summonsAce",
        "summonsMagic",
        "mountSoldier",
        "up",
        "down",
        "twist",
        "counter",
        "destroyBulwark",
        "throwing",
        "deathLance",
        "addBulwark",
        "reanimate",
        "handeth",
        "search",
        "unsummons"
      ]
    },
    "pro": {
      "name": "プロ",
      "href": "https://blackpoker.github.io/BlackPoker/master/format/format.html",
      "actions": [
        "end",
        "charge",
        "draw",
        "attack",
        "block",
        "damageJudge",
        "nextGeneration",
        "setBulwark",
        "summonsSoldier",
        "summonsHero",
        "summonsAce",
        "quickSummonsAce",
        "summonsMagic",
        "mountSoldier",
        "up",
        "down",
        "twist",
        "counter",
        "destroyBulwark",
        "throwing",
        "deathLance",
        "addBulwark",
        "reanimate",
        "handeth",
        "kill",
        "reunion",
        "truce",
        "changeTarget",
        "search",
        "reverse",
        "unsummons"
      ]
    },
    "mast": {
      "name": "マスター",
      "href": "https://blackpoker.github.io/BlackPoker/master/format/format.html",
      "actions": [
        "end",
        "charge",
        "draw",
        "attack",
        "block",
        "damageJudge",
        "nextGeneration",
        "setBulwark",
        "summonsSoldier",
        "summonsHero",
        "summonsAce",
        "quickSummonsAce",
        "summonsMagic",
        "mountSoldier",
        "up",
        "down",
        "twist",
        "counter",
        "destroyBulwark",
        "throwing",
        "deathLance",
        "addBulwark",
        "reanimate",
        "handeth",
        "kill",
        "reunion",
        "truce",
        "changeTarget",
        "search",
        "reverse",
        "unsummons",
        "swordRain",
        "force",
        "recruit",
        "surprise",
        "bj",
        "rsf"
      ]
    }
  }
} as const;
