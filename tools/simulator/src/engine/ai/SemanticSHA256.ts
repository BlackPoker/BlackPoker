/**
 * SemanticSHA256.ts
 *
 * BlackPoker Simulator - AI Semantic Stall / Cycle Diagnostic V1
 *
 * FIPS 180-4 準拠の決定論的ピュア TypeScript SHA-256 実装。
 * - 外部依存ゼロ (Node.js / ブラウザ Vite 環境の双方で 100% 互換)
 * - 常に 64 文字の小文字 Hex 文字列を出力
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class SemanticSHA256 {
  /**
   * 文字列を受け取り、小文字 64 文字の SHA-256 hex ダイジェストを算出
   */
  public static hash(text: string): string {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    return this.hashBytes(data);
  }

  /**
   * バイト配列を受け取り、小文字 64 文字の SHA-256 hex ダイジェストを算出
   */
  public static hashBytes(data: Uint8Array): string {
    const l = data.length;
    // パディング計算: 1 バイト (0x80) + ゼロパディング + 8 バイト (長さビット数)
    // 全体長が 64 バイトの倍数となるようにする
    const bitLen = BigInt(l) * 8n;
    const padLen = (l % 64 < 56) ? (56 - (l % 64)) : (120 - (l % 64));
    const totalLen = l + padLen + 8;

    const padded = new Uint8Array(totalLen);
    padded.set(data, 0);
    padded[l] = 0x80;

    // 長さ (64-bit big endian)
    const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
    view.setBigUint64(totalLen - 8, bitLen, false);

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;

    const w = new Uint32Array(64);

    for (let i = 0; i < totalLen; i += 64) {
      for (let t = 0; t < 16; t++) {
        w[t] = view.getUint32(i + t * 4, false);
      }
      for (let t = 16; t < 64; t++) {
        const s0 = ((w[t - 15] >>> 7) | (w[t - 15] << 25)) ^
                   ((w[t - 15] >>> 18) | (w[t - 15] << 14)) ^
                   (w[t - 15] >>> 3);
        const s1 = ((w[t - 2] >>> 17) | (w[t - 2] << 15)) ^
                   ((w[t - 2] >>> 19) | (w[t - 2] << 13)) ^
                   (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }

      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;

      for (let t = 0; t < 64; t++) {
        const S1 = ((e >>> 6) | (e << 26)) ^
                   ((e >>> 11) | (e << 21)) ^
                   ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^
                   ((a >>> 13) | (a << 19)) ^
                   ((a >>> 22) | (a << 10));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }

      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }

    const toHex = (n: number) => n.toString(16).padStart(8, "0");
    return `${toHex(h0)}${toHex(h1)}${toHex(h2)}${toHex(h3)}${toHex(h4)}${toHex(h5)}${toHex(h6)}${toHex(h7)}`;
  }
}
