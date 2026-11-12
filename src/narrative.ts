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
export interface NarrativeInput {
  /** 指向 schema 的量纲/事实名（喂给叙事 LLM 的 fact_ref） */
  factRef?: string;
  /** 叙事 LLM 可参考的数值（喂给叙事 LLM 的 value，仅示意不结算） */
  value?: unknown;
  /** 世界书三级锚切片（裁剪后，009 Q3 缓存单点） */
  worldbookSlice?: string;
  /** 玩家自由输入（聊天对话框，009 Q1）—— LLM 据此写叙事 */
  text?: string;
}

export async function generateNarrative(
  llm: LlmProvider,
  store: LedgerStore,
  role: string,
  input: NarrativeInput = {},
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
    (input.text ? "玩家输入:\n" + input.text + "\n" : "") +
    (input.worldbookSlice ? "世界书切片:\n" + input.worldbookSlice + "\n" : "") +
    (input.factRef ? "fact_ref: " + input.factRef + "\n" : "") +
    (input.value !== undefined ? "value: " + JSON.stringify(input.value) : "");

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
 * 生成 3 个推进故事的快捷选项（聊天式前端 009 Q1：对话框下方 3 按钮）
 * 产出：{ [选项文案]: {} } —— 文案是玩家可见的短句子，点击后作为叙事输入直接发 /api/narrative
 * MVP 不自动映射 fact_ref/inputs（需要 schema 语义理解，后续再做），选项=纯叙事推进
 */
export async function generateStoryPrompts(
  llm: LlmProvider,
  store: LedgerStore,
  role: string,
): Promise<{ prompts: Record<string, { fact_ref?: string; inputs?: Record<string, unknown> }>; provider: string }> {
  const ks = store.getKnownSet(role);
  const eventLines = ks.slice(-8).map((e) => "  " + e.description).join("\n");

  const res = await llm.complete(
    [
      {
        role: "system",
        content:
          "意图:推进选项。你是这个世界的叙事者，为角色生成 3 个『接下来可以做什么』的短选项" +
          "（每个 ≤18 字，玩家点一下就发）。输出 JSON：{ options: string[] }，恰好 3 条。" +
          "选项要符合世界设定、推进故事，不要重复已知事件。",
      },
      {
        role: "user",
        content:
          "角色: " + role + "\n" +
          "已知事件:\n" + (eventLines || "  (空)") + "\n" +
          "请给 3 个推进故事的快捷选项。",
      },
    ],
    { temperature: 0.8, maxTokens: 300, responseFormat: "json" },
  );

  let parsed: { options?: string[] };
  try {
    parsed = JSON.parse(res.text) as { options?: string[] };
  } catch {
    parsed = { options: [res.text] };
  }
  const opts = (parsed.options ?? []).filter((o) => typeof o === "string" && o.trim()).slice(0, 3);
  const prompts: Record<string, { fact_ref?: string; inputs?: Record<string, unknown> }> = {};
  for (const o of opts) prompts[o.trim()] = {};
  return { prompts, provider: res.provider };
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
