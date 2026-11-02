/**
 * FileCampaignCheckpointStorage.ts
 *
 * Node.js 環境向けファイルベースの CampaignCheckpointStorage 実装。
 *
 * 原子的置換 (Atomic Save) と耐久性 (Durability) の保証境界と仕様:
 * 1. 原子的ファイル置換 (Atomic Rename):
 *    同一ファイルシステム（同一ドライブ/マウントポイント）内において、一時ファイル（tmpFile）への
 *    書き込み完了後に目的ファイル（filePath）への不可分な置換 (fs.renameSync) を行います。
 *    これにより、書き込み途中の破損ファイルが目的ファイルとして観測されることはありません。
 * 2. 失敗時のクリーンアップ:
 *    書き込み失敗時または rename 失敗時は、一時ファイルを安全に削除 (unlinkSync) し、
 *    不完全なファイルが残留して次回ロードを妨害することを防止します。
 * 3. 以前のチェックポイントの保護:
 *    新しいチェックポイントの保存処理中にプロセス強制終了（SIGKILL 等）が発生した場合でも、
 *    以前の checkpoint ファイルが上書き破壊されることなく完全に維持されます。
 * 4. 電源断時耐久性 (Durability / fsync) の境界と制約:
 *    本実装の fs.renameSync はファイルシステムメタデータの不可分切り替えを保証しますが、
 *    OS ページキャッシュから物理記録媒体への強制フラッシュ（fsync / fdatasync）は行っていません。
 *    そのため、物理電源遮断や OS パニック時の完全永続化は、OS およびストレージコントローラの
 *    キャッシュフラッシュポリシーに依存します（プロセスクラッシュや例外停止に対しては上記1〜3により完全に保護されます）。
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
