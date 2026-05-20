export interface CommandContext {
  state: any; // シミュレーターのゲーム状態
  playerKey: string; // 実行するプレイヤー ("p1" | "p2")
  keyCard?: any; // キーカード情報
  targetComponent?: any; // 対象となったコンポーネント/ユニット
}

export type CommandHandler = (args: Record<string, any>, context: CommandContext) => void;

/**
 * 高レベル命令（createFog, summonUnit 等）を登録・解釈・実行するレジストリ。
 * 将来的に低レベルIRへ展開する入口となる。
 */
export class CommandRegistry {
  private handlers = new Map<string, CommandHandler>();

  constructor() {
    this.registerDefaults();
  }

  /**
   * 新しい高レベル命令ハンドラーを登録する
   */
  register(name: string, handler: CommandHandler) {
    this.handlers.set(name, handler);
  }

  /**
   * 命令を実行する
   */
  execute(name: string, args: Record<string, any>, context: CommandContext) {
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new Error(`未定義の高レベル命令です: ${name}`);
    }
    handler(args, context);
  }

  /**
   * デフォルトの検証用命令ハンドラーを登録
   */
  private registerDefaults() {
    // createFog: フォグの生成と配置
    this.register("createFog", (args, context) => {
      const { component, bindings } = args;
      const player = context.state.players[context.playerKey];
      if (!player) throw new Error(`プレイヤーが見つかりません: ${context.playerKey}`);

      // バインディング値の解決
      const resolvedBindings: Record<string, any> = {};
      if (bindings) {
        for (const [key, value] of Object.entries(bindings)) {
          if (value === "key.rankValue" && context.keyCard) {
            resolvedBindings[key] = context.keyCard.value;
          } else if (value === "target" && context.targetComponent) {
            resolvedBindings[key] = context.targetComponent.unitId;
          } else {
            resolvedBindings[key] = value;
          }
        }
      }

      const newFog = {
        fogId: `fog-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        componentId: component,
        card: context.keyCard, // キーカードを配置
        bindings: resolvedBindings,
      };

      player.fog.push(newFog);
    });

    // summonUnit: ユニットの召喚
    this.register("summonUnit", (args, context) => {
      const { component, face, state } = args;
      const player = context.state.players[context.playerKey];
      if (!player) throw new Error(`プレイヤーが見つかりません: ${context.playerKey}`);

      const newUnit = {
        unitId: `unit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind: component === "character.soldier" ? "一般兵" : "ユニット",
        componentId: component,
        state: state || "charge",
        face: face || "up",
        cards: context.keyCard ? [context.keyCard] : [],
        labels: ["攻撃", "防御"],
      };

      // 手札からキーカードを消費（手札にある場合のみ）
      if (context.keyCard) {
        player.hand = player.hand.filter((c: any) => c.id !== context.keyCard.id);
      }

      player.field.push(newUnit);
    });
  }
}
