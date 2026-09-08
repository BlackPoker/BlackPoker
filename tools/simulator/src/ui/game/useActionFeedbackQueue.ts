import { useState, useRef, useCallback, useEffect } from "react";
import { ActionFeedbackItem } from "../../engine/session/playtest/ActionFeedbackComposer";

export interface UseActionFeedbackQueueReturn {
  readonly currentItem: ActionFeedbackItem | null;
  readonly pendingCount: number;
  readonly enqueue: (items: readonly ActionFeedbackItem[]) => void;
  readonly reset: () => void;
  readonly skipCurrent: () => void;
}

/**
 * Action Feedback Flash の FIFO キューおよびライフサイクルを管理する純粋なコントローラ。
 * React レンダリングに依存せず、vi.useFakeTimers での厳密な単体テストが可能です。
 */
export class ActionFeedbackQueueController {
  private queue: ActionFeedbackItem[] = [];
  private activeItem: ActionFeedbackItem | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private onUpdate?: (item: ActionFeedbackItem | null, pendingCount: number) => void;

  constructor(onUpdate?: (item: ActionFeedbackItem | null, pendingCount: number) => void) {
    this.onUpdate = onUpdate;
  }

  getCurrentItem(): ActionFeedbackItem | null {
    return this.activeItem;
  }

  getPendingCount(): number {
    return this.queue.length;
  }

  enqueue(items: readonly ActionFeedbackItem[]): void {
    if (!items || items.length === 0) return;
    this.queue.push(...items);
    this.notify();

    if (!this.timerId) {
      this.processNext();
    }
  }

  /**
   * 現在表示中の Flash のタイマーを破棄し、キュー内の次アイテムへ即座に遷移します。
   * キューが空の場合は即座に非表示 (null) となります。
   */
  skipCurrent(): void {
    if (!this.activeItem && this.queue.length === 0) return;
    this.clearTimer();
    this.processNext();
  }

  private processNext(): void {
    if (this.queue.length === 0) {
      this.activeItem = null;
      this.notify();
      return;
    }

    this.activeItem = this.queue.shift()!;
    this.notify();

    // キュー残量に応じた動的表示時間 (バックログが溜まっている場合は高速消化)
    const backlog = this.queue.length;
    const duration = backlog >= 3 ? 500 : backlog >= 1 ? 800 : 1400;

    this.clearTimer();
    this.timerId = setTimeout(() => {
      this.timerId = null;
      this.processNext();
    }, duration);
  }

  reset(): void {
    this.clearTimer();
    this.queue = [];
    this.activeItem = null;
    this.notify();
  }

  /**
   * アンマウント時の完全な後始末。
   * 通知コールバックを解除することで unmount 後の React setState 警告を完全に防止します。
   */
  dispose(): void {
    this.clearTimer();
    this.onUpdate = undefined;
    this.queue = [];
    this.activeItem = null;
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private notify(): void {
    this.onUpdate?.(this.activeItem, this.queue.length);
  }
}

/**
 * Action Feedback Flash の FIFO キューおよびライフサイクル管理フック。
 * 画面上部のトースト/バッジ表示を非ブロッキングで制御します。
 * ゲームリセットや環境切替時には明示的な reset() で即座に全タイマー・キューを破棄します。
 */
export function useActionFeedbackQueue(): UseActionFeedbackQueueReturn {
  const [currentItem, setCurrentItem] = useState<ActionFeedbackItem | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);

  const controllerRef = useRef<ActionFeedbackQueueController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new ActionFeedbackQueueController((item, count) => {
      setCurrentItem(item);
      setPendingCount(count);
    });
  }

  const enqueue = useCallback((items: readonly ActionFeedbackItem[]) => {
    controllerRef.current?.enqueue(items);
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.reset();
  }, []);

  const skipCurrent = useCallback(() => {
    controllerRef.current?.skipCurrent();
  }, []);

  // アンマウント時の安全な破棄 (dispose により unmount 後の setState を完全防止)
  useEffect(() => {
    return () => {
      controllerRef.current?.dispose();
    };
  }, []);

  return {
    currentItem,
    pendingCount,
    enqueue,
    reset,
    skipCurrent,
  };
}
