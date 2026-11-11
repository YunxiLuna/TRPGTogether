// 共典 · Mock LLM provider（MVP 默认，零网络依赖，确定性可复现）
// 用途：在无 API key 的环境下跑通"叙事 LLM 提议→账本入账"全链路。
// 输出形态：JSON（narrative + 提议数值 + 分类），与 OpenAI 兼容 provider 同构。

import type { LlmMessage, LlmCompletionOptions, LlmCompletionResult, LlmProvider } from "./types.js";

export class MockProvider implements LlmProvider {
  readonly name = "mock";
  private seed: number;

  constructor(seed = 42) {
    this.seed = seed;
  }

  async complete(messages: LlmMessage[], opts?: LlmCompletionOptions): Promise<LlmCompletionResult> {
    // 确定性伪随机（mulberry32），让同一 seed 下输出可复现
    const rand = this.mulberry32(this.seed);
    const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
    const userMsg = messages.find((m) => m.role === "user")?.content ?? "";

    // 按 system prompt 的意图开关分支（调用方在 system 里写意图标签）
    if (systemMsg.includes("意图:分类")) {
      // 叙事矛盾分类（004 Q4 LLM advisory）：rumor / side_worldline / unresolved
      const label = systemMsg.includes("label=rumor")
        ? "rumor"
        : systemMsg.includes("label=side_worldline")
          ? "side_worldline"
          : "unresolved";
      const body = JSON.stringify({
        classification: label,
        note: "mock 分类（零 LLM，可替换为真实 provider）",
      });
      return this.finish(body, messages.length, rand);
    }

    if (systemMsg.includes("意图:叙事")) {
      // 叙事层：根据 user 里的 fact_ref/value 编一段世界观文案 + 可选提议数值
      const m = userMsg.match(/fact_ref[:=]\s*([^\n]+)/);
      const factRef = m?.[1]?.trim() ?? "事件";
      const v = userMsg.match(/value[:=]\s*([^\n]+)/);
      const value = v?.[1]?.trim() ?? "";
      const tone = ["山雨欲来", "雷声隐隐", "灵气激荡", "道韵流转"][Math.floor(rand() * 4)];
      const narrative = tone + "——" + factRef + (value ? "（" + value + "）" : "") + "。" + (rand() < 0.5 ? "夜色加深，众人心头一凛。" : "远处传来钟声，节奏缓慢。");
      const body = JSON.stringify({
        narrative,
        suggested_value: value ? value : null, // 叙事提议（只能写 proposals partition，引擎是唯一结算写者）
        note: "mock 叙事（零 LLM，可替换为真实 provider）",
      });
      return this.finish(body, messages.length, rand);
    }

    // 兜底：通用 JSON
    const body = JSON.stringify({ narrative: "（mock）发生了一件不确定的事。", suggested_value: null });
    return this.finish(body, messages.length, rand);
  }

  private finish(body: string, nMsgs: number, _rand: () => number): LlmCompletionResult {
    // mock 的 token 估算：粗按字符数/2 估（仅用于记录用量）
    return {
      text: body,
      usage: { inputTokens: Math.ceil(nMsgs * 20), outputTokens: Math.ceil(body.length / 2) },
      provider: "mock",
    };
  }

  /** mulberry32 确定性 PRNG */
  private mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
