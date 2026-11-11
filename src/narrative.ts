// 共典 · 叙事层（002 决议②：叙事 LLM 只能提议，引擎是唯一结算写者）
// 对齐 004 Q4：两人矛盾时 LLM 只做叙事矛盾分类（advisory，不改正典值）
// 对齐 009 Q3：叙事调用走服务器 1 个 LLM 网关（缓存单点共享）

import type { LlmProvider, LlmMessage } from "./llm/types.js";
import type { LedgerStore } from "./ledger.js";

/** 叙事层产物（proposals partition 条目，绝不写进结算 partition） */
export interface NarrativeProposal {
  /** 角色（叙述视角） */
  role: string;
  /** 世界观叙事文案（玩家可见） */
  narrative: string;
  /** 叙事 LLM 提议的数值（仅记录，不生效——引擎是唯一结算写者） */
  suggested_value?: unknown;
  /** provider 标识（审计） */
  provider: string;
  /** token 用量（限流/预算审计） */
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * 生成叙事（009 Q3 调用点①：叙事 LLM 主调用）
 * 喂：角色 KnownSet 裁剪后的事件 + schema 可见子集 + 世界书三级锚切片
 * 产出：世界观叙事 + 可选提议数值（只写 proposals，不改已结算值）
 */
export async function generateNarrative(
  llm: LlmProvider,
  store: LedgerStore,
  role: string,
  worldbookSlice?: string,
): Promise<NarrativeProposal> {
  const ks = store.getKnownSet(role);
  // 裁剪上下文（009 Q3 缓存单点：KnownSet 裁剪后的事件全在服务器内存）
  const eventLines = ks.slice(-10).map((e) => "  " + e.description).join("\n");

  const systemMsg =
    "意图:叙事。你是这个世界的叙事者。根据下方已知事件，写一段 2-3 句的世界观叙事。" +
    "你只能『提议』数值，不能改写已结算值——结算由引擎完成。" +
    "输出 JSON：{ narrative: string, suggested_value: any|null }。";

  const userMsg =
    "角色: " + role + "\n" +
    "已知事件:\n" + (eventLines || "  (空)") + "\n" +
    (worldbookSlice ? "世界书切片:\n" + worldbookSlice + "\n" : "") +
    "fact_ref: 突破成功率\n" +
    "value: 混合总成功率";

  const res = await llm.complete([
    { role: "system", content: systemMsg },
    { role: "user", content: userMsg },
  ] as LlmMessage[], { temperature: 0.7, maxTokens: 512, responseFormat: "json" });

  let parsed: { narrative?: string; suggested_value?: unknown };
  try {
    parsed = JSON.parse(res.text) as { narrative?: string; suggested_value?: unknown };
  } catch {
    parsed = { narrative: res.text }; // 解析失败时原文入文案
  }

  return {
    role,
    narrative: parsed.narrative ?? res.text,
    suggested_value: parsed.suggested_value ?? null,
    provider: res.provider,
    usage: res.usage,
  };
}

/**
 * 叙事矛盾分类（004 Q4：LLM 只做分类，输出 advisory 写旁支条目 classification 字段，不改正典值）
 * 三分类：rumor / side_worldline / unresolved
 */
export async function classifyNarrativeConflict(
  llm: LlmProvider,
  first: { actor: string; fact_ref: string; value: unknown },
  second: { actor: string; fact_ref: string; value: unknown },
): Promise<{ classification: "rumor" | "side_worldline" | "unresolved"; note?: string }> {
  // 先提交者正典、后提交者旁支（004 Q4 先正典后旁支）
  // LLM 只判断叙事矛盾类型，不改数值定序（定序=seq 机械决定）
  const systemMsg =
    "意图:分类。两条事件存在叙事矛盾（两人声称不能同时真之事）。" +
    "只判断类型，不改数值。输出 JSON：{ classification: 'rumor'|'side_worldline'|'unresolved', note?: string }。" +
    "rumor=传闻（一方在传话）；side_worldline=平行世界线（假设性分歧）；unresolved=未决（缺信息）。";
  const userMsg =
    "先提交（正典）: actor=" + first.actor + " fact_ref=" + first.fact_ref + " value=" + JSON.stringify(first.value) + "\n" +
    "后提交（旁支）: actor=" + second.actor + " fact_ref=" + second.fact_ref + " value=" + JSON.stringify(second.value);

  const res = await llm.complete([
    { role: "system", content: systemMsg },
    { role: "user", content: userMsg },
  ] as LlmMessage[], { temperature: 0.1, maxTokens: 256, responseFormat: "json" });

  try {
    const parsed = JSON.parse(res.text) as { classification?: string; note?: string };
    const c = parsed.classification === "rumor" || parsed.classification === "side_worldline" ? parsed.classification : "unresolved";
    return { classification: c, note: parsed.note };
  } catch {
    return { classification: "unresolved", note: "分类解析失败，保守归未决" };
  }
}
