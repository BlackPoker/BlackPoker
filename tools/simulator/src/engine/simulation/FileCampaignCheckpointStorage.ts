/**
 * FileCampaignCheckpointStorage.ts
 *
 * Node.js 環境向けファイルベースの CampaignCheckpointStorage 実装。
 *
 * 原子的置換 (Atomic Save) の保証条件:
 * 1. 同一ファイルシステム（同一ドライブ/マウントポイント）内において、一時ファイル（tmpFile）から
 *    目的ファイル（filePath）への不可分な置換 (fs.renameSync) を行います。
 * 2. 書き込み失敗時または rename 失敗時は、一時ファイルを安全に削除 (unlinkSync) し、
 *    不完全なファイルが残留して次回ロードを妨害することを防止します。
 * 3. 呼び出し元がプロセス強制終了（SIGKILL / 物理電源断等）された場合でも、
 *    以前の checkpoint ファイルが上書き破壊されることなく完全に維持されます。
 */

import * as fs from "fs";
import * as path from "path";
import { CampaignCheckpointStorage } from "../../domain/ai/EvolutionCampaignTypes.js";

export class FileCampaignCheckpointStorage implements CampaignCheckpointStorage {
  public save(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpFile = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    try {
      fs.writeFileSync(tmpFile, content, "utf-8");
      fs.renameSync(tmpFile, filePath);
    } catch (err) {
      if (fs.existsSync(tmpFile)) {
        try {
          fs.unlinkSync(tmpFile);
        } catch {
          // 一時ファイル削除失敗は破棄
        }
      }
      throw err;
    }
  }

  public load(filePath: string): string | null {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, "utf-8");
  }

  public exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }
}
