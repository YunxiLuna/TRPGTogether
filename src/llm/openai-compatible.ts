// 共典 · OpenAI 兼容 LLM provider（009 Q3：可替换本地模型，1 处配置）
// 走 Node 24 内置 fetch，零新增依赖。baseUrl 缺省 https://api.openai.com/v1，
// 可指向任何 OpenAI 兼容端点（llama.cpp server、vLLM、DeepSeek 等）。

import type { LlmMessage, LlmCompletionOptions, LlmCompletionResult, LlmProvider } from "./types.js";

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: string;
  private baseUrl: string;
  private apiKey: string;
  private defaultModel?: string;
  private timeoutMs: number;

  constructor(baseUrl: string, apiKey: string, defaultModel?: string, timeoutMs = 30_000) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
    this.timeoutMs = timeoutMs;
    this.name = "openai-compatible(" + baseUrl + ")";
  }

  async complete(messages: LlmMessage[], opts?: LlmCompletionOptions): Promise<LlmCompletionResult> {
    if (!this.apiKey) {
      throw new Error("OpenAI 兼容 provider 缺少 apiKey（设 TRPG_LLM_API_KEY）");
    }
    const model = opts?.model ?? this.defaultModel ?? "gpt-4o-mini";
    const body = JSON.stringify({
      model,
      messages,
      temperature: opts?.temperature ?? 0.7,
      max_tokens: opts?.maxTokens ?? 1024,
      ...(opts?.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
    });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const resp = await fetch(this.baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + this.apiKey,
        },
        body,
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error("LLM HTTP " + resp.status + ": " + text.slice(0, 200));
      }
      const data = (await resp.json()) as {
        choices: { message: { content: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = data.choices[0]?.message?.content ?? "";
      return {
        text,
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
        },
        provider: this.name,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
