// 共典 · 缺席简报（005 Q5 最小口径：读 rumor 条目现成 description，零 LLM）
// 对齐 docs/spec/共典/005-信息不对称.md

import type { KnownSetEntry } from "./types.js";
import type { LedgerStore } from "./ledger.js";

export interface BriefingItem {
  fact_ref: string;
  blur_level: "none" | "high" | "max";
  perspective: string;
  render: string;
}

export interface AbsenceBriefing {
  target: string;
  window: { from_seq: number; to_seq: number };
  items: BriefingItem[];
}

/**
 * 005 Q5：缺席简报投影
 * MVP 最小口径：读 KnownSet 中该角色的 rumor 条目（blur=max）的现成 description
 * 复用 005 分类函数 blur_level，零额外 LLM
 */
export function buildAbsenceBriefing(
  store: LedgerStore,
  target: string,
  from_seq: number,
  to_seq: number,
): AbsenceBriefing {
  const ks = store.getKnownSet(target);
  const items: BriefingItem[] = [];

  for (const entry of ks) {
    if (entry.blur_level !== "max") continue;
    // 只取窗口内的条目
    const refMatch = entry.ref.match(/^(rumor_|ev_)(\d+)$/);
    if (!refMatch) continue;
    const seq = parseInt(refMatch[2], 10);
    if (seq < from_seq || seq > to_seq) continue;

    // 现成 description 就是渲染文案（008 刻意不做⑧：不生成新文案模板）
    items.push({
      fact_ref: entry.ref,
      blur_level: "max",
      perspective: "角色内",
      render: entry.description,
    });
  }

  return {
    target,
    window: { from_seq, to_seq },
    items,
  };
}
