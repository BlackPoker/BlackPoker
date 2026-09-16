/**
 * OptionSelectionValidator.ts
 *
 * selectOption DSL 定義の厳格バリデーション (SSOT & fail-closed)。
 * 壊れた Rule DSL から合法パターン 0 件の解決不能 DecisionRequest が生成されるのを防止します。
 */

export interface OptionItemDefinition {
  value: string;
  label?: string;
}

export interface ValidatedOptionSelection {
  id: string;
  chooser?: string;
  decisionPlayer?: string;
  options: OptionItemDefinition[];
}

/**
 * selectOption DSL 定義の厳格バリデーション
 */
export function validateOptionSelectionDefinition(args: any): ValidatedOptionSelection {
  if (!args || typeof args !== "object") {
    throw new Error("selectOption: 引数がオブジェクトではありません");
  }

  const id = args.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error(`selectOption: id は空でない文字列である必要があります (指定値: ${JSON.stringify(id)})`);
  }

  const options = args.options;
  if (!Array.isArray(options)) {
    throw new Error(`selectOption: options は配列である必要があります (selection: '${id}')`);
  }
  if (options.length === 0) {
    throw new Error(`selectOption: options には1件以上の選択肢が必要です (selection: '${id}')`);
  }

  const seenValues = new Set<string>();
  const validatedOptions: OptionItemDefinition[] = [];

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (!opt || typeof opt !== "object" || Array.isArray(opt)) {
      throw new Error(`selectOption: options[${i}] はオブジェクトである必要があります (selection: '${id}')`);
    }

    const value = opt.value;
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`selectOption: options[${i}].value は空でない文字列である必要があります (selection: '${id}')`);
    }

    if (seenValues.has(value)) {
      throw new Error(`selectOption: options に重複した value が指定されています: '${value}' (selection: '${id}')`);
    }
    seenValues.add(value);

    let label: string | undefined = undefined;
    if (opt.label !== undefined) {
      if (typeof opt.label !== "string") {
        throw new Error(`selectOption: options[${i}].label は文字列である必要があります (selection: '${id}')`);
      }
      label = opt.label;
    }

    validatedOptions.push({ value, label });
  }

  return {
    id,
    chooser: args.chooser,
    decisionPlayer: args.decisionPlayer,
    options: validatedOptions,
  };
}
