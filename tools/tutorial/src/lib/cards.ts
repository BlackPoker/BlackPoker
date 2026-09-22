const suits: Record<string, string> = {
  S: "♠",
  H: "♥",
  D: "♢",
  C: "♣",
};

export const cardName = (code: string) =>
  (suits[code[0]] || "") + code.slice(1);
