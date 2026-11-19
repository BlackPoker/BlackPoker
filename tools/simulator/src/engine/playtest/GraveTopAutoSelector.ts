import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import {
  formatCardDisplay,
  formatOfficialSuitSymbol,
  isJokerCard,
} from "../rules/cardUtils";

/**
 * 墓地TOP選択モードの型定義
 */
export type GraveTopSelectionMode = "manual" | "auto";

/**
 * 墓地TOP自動選択の入力パラメータ
 */
export interface GraveTopAutoSelectParams {
  readonly request: DecisionRequest;
  readonly matchSeed: number | string;
  readonly stateVersion?: number;
}

/**
 * 墓地TOP自動選択の結果
 */
export interface GraveTopAutoSelectResult {
  readonly selectedPatternRef: number;
  readonly selectedCardId: string;
  readonly candidateCardIds: readonly string[];
}

/**
 * 32-bit FNV-1a ハッシュ関数
 * 文字列とシード値から決定論的な 32 ビット符号なし整数ハッシュを算出します。
 */
export function hashFnv1a32(input: string, seed: number = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 32-bit 整数ビットミキサー (MurmurHash3 fmix32 相当)
 * アバランシェ効果により、隣接するシード値やバージョン番号でも下位ビットを均一に分散させます。
 */
export function mix32(h: number): number {
  let k = h >>> 0;
  k ^= k >>> 16;
  k = Math.imul(k, 0x85ebca6b);
  k ^= k >>> 13;
  k = Math.imul(k, 0xc2b2ae35);
  k ^= k >>> 16;
  return k >>> 0;
}

/**
 * DecisionRequest から墓地TOP候補カードIDと patternRef のマップを抽出します。
 */
export function extractCandidateCardIds(request: DecisionRequest): {
  candidateCardIds: string[];
  patternRefMap: Map<string, number>;
} {
  const candidateCardIds: string[] = [];
  const patternRefMap = new Map<string, number>();

  if (!request.patterns || !request.catalog?.effectSelections) {
    return { candidateCardIds, patternRefMap };
  }

  for (let patternRef = 0; patternRef < request.patterns.length; patternRef++) {
    const pattern = request.patterns[patternRef];
    if (pattern.kind === "EFFECT_SELECTION" && pattern.effectSelectionRef !== undefined) {
      const effSel = request.catalog.effectSelections[pattern.effectSelectionRef];
      if (effSel?.selectedValues && effSel.selectedValues.length > 0) {
        const cardId = effSel.selectedValues[0];
        if (!patternRefMap.has(cardId)) {
          candidateCardIds.push(cardId);
          patternRefMap.set(cardId, patternRef);
        }
      }
    }
  }

  return { candidateCardIds, patternRefMap };
}

/**
 * ZONE_TOP_SELECTION DecisionRequest に対し、再構築可能な情報（対戦Seed、stateVersion、playerId、合法候補カードID）から
 * 決定論的・擬似ランダムに墓地TOP候補を1枚選択する純粋関数です。
 *
 * 【設計保証】
 * 1. 既存の GraveTopCoordinator および ZONE_TOP_SELECTION のコアロジックは変更しません。
 * 2. Date.now()、Math.random()、およびランダム文字列を含む不安定な decisionId は一切使用しません。
 * 3. AI Policy の PRNG 状態は一切消費・汚染しません。
 * 4. 同一局面（同一 matchSeed, stateVersion, playerId, 候補ID）で常に 100% 同一のカードが選ばれます。
 * 5. 候補カードIDを安定ソート（昇順）した上でインデックスを決定し、実際の request.patterns の selectedPatternRef を返します。
 */
export function selectAutoGraveTopCandidate(
  params: GraveTopAutoSelectParams
): GraveTopAutoSelectResult {
  const { request, matchSeed, stateVersion } = params;

  if (request.source?.type !== "ZONE_TOP_SELECTION") {
    throw new Error(
      `selectAutoGraveTopCandidate: request.source.type は "ZONE_TOP_SELECTION" である必要があります (受信: "${request.source?.type}")`
    );
  }

  const { candidateCardIds, patternRefMap } = extractCandidateCardIds(request);
  if (candidateCardIds.length === 0) {
    throw new Error("selectAutoGraveTopCandidate: 合法な墓地TOP候補カードが見つかりません。");
  }

  // 候補が1枚のみの場合は無条件でその1枚を選択
  if (candidateCardIds.length === 1) {
    const onlyCardId = candidateCardIds[0];
    const patternRef = patternRefMap.get(onlyCardId)!;
    return {
      selectedPatternRef: patternRef,
      selectedCardId: onlyCardId,
      candidateCardIds,
    };
  }

  // 候補カードIDを安定した順序（昇順）に正規化
  const normalizedCandidateIds = [...candidateCardIds].sort();

  // 再構築可能な情報のみでシード文字列を構成（decisionId やタイムスタンプは除外）
  const resolvedStateVersion = stateVersion ?? request.stateVersion ?? 1;
  const resolvedPlayerId = request.playerId;
  const seedPayload = `matchSeed:${matchSeed}|stateVersion:${resolvedStateVersion}|playerId:${resolvedPlayerId}|candidates:${normalizedCandidateIds.join(",")}`;

  // 初期シード数値の算出
  const baseSeedNum =
    typeof matchSeed === "number" && Number.isFinite(matchSeed)
      ? matchSeed >>> 0
      : hashFnv1a32(String(matchSeed));

  // ハッシュ計算とビットミキシング
  const rawHash = hashFnv1a32(seedPayload, baseSeedNum);
  const mixedHash = mix32(rawHash);

  // 正規化配列からインデックスを決定
  const selectedIndex = mixedHash % normalizedCandidateIds.length;
  const selectedCardId = normalizedCandidateIds[selectedIndex];
  const selectedPatternRef = patternRefMap.get(selectedCardId);

  if (selectedPatternRef === undefined) {
    throw new Error(
      `selectAutoGraveTopCandidate: カードID "${selectedCardId}" に対応する patternRef が見つかりません。`
    );
  }

  return {
    selectedPatternRef,
    selectedCardId,
    candidateCardIds: normalizedCandidateIds,
  };
}

/**
 * カードオブジェクトまたは文字列表記から公式スート記号（♠, ♥, ♦, ♣）を用いた表示文字列を生成します。
 */
function formatWithOfficialSuit(card: any): string {
  if (!card) return "";
  if (typeof card === "string") {
    const trimmed = card.trim();
    if (trimmed.toLowerCase() === "jk" || trimmed.toLowerCase() === "joker") {
      return "Joker";
    }
    const match = trimmed.match(/^([shdcSHDC♠♡♢♣♥♦])(10|[2-9ajqkAJQK])$/);
    if (match) {
      const sym = formatOfficialSuitSymbol(match[1]);
      const rank = match[2].toUpperCase();
      return `${sym}${rank}`;
    }
    const replaced = trimmed.replace(/♡/g, "♥").replace(/♢/g, "♦");
    return replaced;
  }
  if (card.visibility === "HIDDEN" || (!card.suit && !card.rank)) return "🂠";
  if (isJokerCard(card)) return "Joker";
  const symbol = formatOfficialSuitSymbol(card.suit);
  const rank = card.rank !== undefined ? String(card.rank) : "";
  return `${symbol}${rank}`;
}

/**
 * 物理カードID（"p2-l1", "c-dmg-a" 等）から実際の公開カード情報（スート・ランク）を抽出し、
 * "♠A" や "♥8" などの人間可読な公式文字列表現を解決するヘルパー関数です。
 */
export function resolveCardDisplayName(
  cardId: string,
  state?: any,
  request?: DecisionRequest
): string {
  if (!cardId) return "";

  // 1. request.catalog.effectSelections の summary から抽出
  if (request?.catalog?.effectSelections && request?.patterns) {
    for (const pat of request.patterns) {
      if (pat.kind === "EFFECT_SELECTION" && pat.effectSelectionRef !== undefined) {
        const eff = request.catalog.effectSelections[pat.effectSelectionRef];
        if (eff?.selectedValues?.includes(cardId) && eff.summary) {
          const match = eff.summary.match(/\[(.*?)\]/);
          if (
            match &&
            match[1] &&
            !match[1].startsWith("c-") &&
            !match[1].startsWith("card-") &&
            !match[1].startsWith("p1-") &&
            !match[1].startsWith("p2-")
          ) {
            return formatWithOfficialSuit(match[1]);
          }
        }
      }
    }
  }

  // 2. state または observation からカード実体を探索
  const searchRoots = [state, request?.observation];
  for (const root of searchRoots) {
    if (!root?.players) continue;
    for (const pKey of Object.keys(root.players)) {
      const p = root.players[pKey];
      if (!p) continue;
      // grave 内を探索
      if (Array.isArray(p.grave)) {
        for (const item of p.grave) {
          if (item?.id === cardId && (item.suit || item.rank)) {
            return formatWithOfficialSuit(item);
          }
          if (Array.isArray(item?.cards)) {
            const found = item.cards.find((c: any) => c?.id === cardId);
            if (found && (found.suit || found.rank)) {
              return formatWithOfficialSuit(found);
            }
          }
        }
      }
      // life, hand も探索
      for (const zone of ["life", "hand"] as const) {
        if (Array.isArray(p[zone])) {
          const found = p[zone].find((c: any) => c?.id === cardId);
          if (found && (found.suit || found.rank)) {
            return formatWithOfficialSuit(found);
          }
        }
      }
    }
  }

  // 3. 短縮表記 (s10, hA, dK, sA, hK, cJ 等) の直接フォーマット
  const formatted = formatWithOfficialSuit(cardId);
  if (formatted && formatted !== cardId) {
    return formatted;
  }

  // 4. フォールバック
  return cardId;
}
