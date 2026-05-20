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
   * ユニットに適用されているすべてのフォグの amount 累積値を反映したサイズ計算を行います。
   */
  calculateUnitSize(unit: any, player: any): number {
    if (!unit) return 0;
    let size = unit.cards ? unit.cards.reduce((sum: number, c: any) => sum + (c.value || 0), 0) : 0;
    if (player && player.fog) {
      for (const fog of player.fog) {
        if (fog.bindings && fog.bindings.target === unit.unitId) {
          size += fog.bindings.amount || 0;
        }
      }
    }
    return size;
  }

  /**
   * 単一の効果コマンドを実行します（if分岐対応）。
   */
  executeEffect(effect: any, context: CommandContext) {
    const keys = Object.keys(effect);
    if (keys.length === 0) return;
    const name = keys[0];
    const args = effect[name];

    if (name === "if") {
      if (this.evaluateCondition(args.condition, context)) {
        if (args.then && Array.isArray(args.then)) {
          this.executeEffects(args.then, context);
        }
      }
    } else {
      this.execute(name, args, context);
    }
  }

  /**
   * 効果コマンドのリストを順次実行します。
   */
  executeEffects(effects: any[], context: CommandContext) {
    for (const effect of effects) {
      this.executeEffect(effect, context);
    }
  }

  /**
   * 条件判定を評価します。
   */
  private evaluateCondition(conditionStr: string, context: CommandContext): boolean {
    if (conditionStr === "target.size <= 0") {
      const player = context.state.players[context.playerKey];
      const size = this.calculateUnitSize(context.targetComponent, player);
      return size <= 0;
    }
    return false;
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
          } else if (value === "-key.rankValue" && context.keyCard) {
            resolvedBindings[key] = -context.keyCard.value;
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

    // removeFog: フォグの削除
    this.register("removeFog", (args, context) => {
      const { component, target } = args;
      const player = context.state.players[context.playerKey];
      if (!player) throw new Error(`プレイヤーが見つかりません: ${context.playerKey}`);

      const targetUnitId = target === "target" && context.targetComponent
        ? context.targetComponent.unitId
        : target;

      player.fog = player.fog.filter((f: any) => {
        const matchComponent = f.componentId === component;
        const matchTarget = targetUnitId ? f.bindings.target === targetUnitId : true;
        return !(matchComponent && matchTarget);
      });
    });

    // moveToGraveyard: ユニットを墓地へ移動
    this.register("moveToGraveyard", (args, context) => {
      const { target } = args;
      const player = context.state.players[context.playerKey];
      if (!player) throw new Error(`プレイヤーが見つかりません: ${context.playerKey}`);

      const targetUnit = target === "target" ? context.targetComponent : null;
      if (!targetUnit) return;

      // フィールドから除外
      player.field = player.field.filter((u: any) => u.unitId !== targetUnit.unitId);

      // 墓地へ追加
      if (!player.grave) {
        player.grave = [];
      }
      player.grave.push(targetUnit);
    });
  }
}
