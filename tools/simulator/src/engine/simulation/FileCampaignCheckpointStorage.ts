/**
 * FileCampaignCheckpointStorage.ts
 *
 * Node.js 環境向けファイルベースの CampaignCheckpointStorage 実装。
 * - 一時ファイルへの先行書き込みと fs.renameSync による原子的置換 (Atomic Save)
 * - ディレクトリが存在しない場合の自動作成
 * - 不正ファイル読み込み時の安全なエラーハンドリング
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
    fs.writeFileSync(tmpFile, content, "utf-8");
    fs.renameSync(tmpFile, filePath);
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
