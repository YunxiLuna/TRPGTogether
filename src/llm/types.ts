// 共典 · LLM 网关类型（009 Q3：服务器侧唯一 LLM 网关）
// 对齐 002 决议②：叙事 LLM 只能"提议"，不能改写引擎输出（proposals partition）

import { MockProvider } from "./mock.js";
import { OpenAiCompatibleProvider } from "./openai-compatible.js";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCompletionOptions {
  /** 温度（0-1，叙事层用 0.7，事实归类用 0.1） */
  temperature?: number;
  /** 最大输出 token（MVP 默认 1024） */
  maxTokens?: number;
  /** 模型（缺省读 TRPG_LLM_MODEL） */
  model?: string;
  /** 响应 JSON 模式（OpenAI 兼容） */
  responseFormat?: "json" | "text";
}

export interface LlmCompletionResult {
  /** 完成文本（json 模式下是 JSON 字符串，调用方解析） */
  text: string;
  /** 实际消耗的 input/output token（估算或 provider 回报） */
  usage: { inputTokens: number; outputTokens: number };
  /** provider 名称（审计用） */
  provider: string;
}

/** LLM provider 抽象（OpenAI 兼容 + mock 双实现） */
export interface LlmProvider {
  /** provider 标识（审计/限流用） */
  readonly name: string;
  /** 同步/异步完成调用 */
  complete(messages: LlmMessage[], opts?: LlmCompletionOptions): Promise<LlmCompletionResult>;
}

/** 工厂：按环境变量选择 provider（009 Q3 三重收益之"限流与本地模型替换 1 处配置"） */
export type LlmProviderConfig =
  | { kind: "mock"; seed?: number }
  | {
      kind: "openai-compatible";
      baseUrl: string;
      apiKey: string;
      model?: string;
      timeoutMs?: number;
    };

export function createLlmProvider(config: LlmProviderConfig): LlmProvider {
  if (config.kind === "mock") return new MockProvider(config.seed);
  if (config.kind === "openai-compatible")
    return new OpenAiCompatibleProvider(
      config.baseUrl,
      config.apiKey,
      config.model,
      config.timeoutMs,
    );
  throw new Error("unknown provider kind");
}

/** 从环境变量读取默认配置（MVP：TRPG_LLM_PROVIDER=mock|openai-compatible，缺省 mock） */
export function providerFromEnv(): LlmProviderConfig {
  const kind = (process.env.TRPG_LLM_PROVIDER ?? "mock") as string;
  if (kind === "openai-compatible") {
    const baseUrl = process.env.TRPG_LLM_BASE_URL ?? "https://api.openai.com/v1";
    const apiKey = process.env.TRPG_LLM_API_KEY ?? "";
    const model = process.env.TRPG_LLM_MODEL;
    return { kind: "openai-compatible", baseUrl, apiKey, model };
  }
  // mock（缺省，MVP 默认，零网络依赖）
  return { kind: "mock" };
}
