// 共典 · 共享类型定义
// 对齐 docs/spec/共典/ 005-信息不对称.md · 006-面板契约三层.md · 003-schema-子系统.md · 004-引擎权威性.md

/** 账本事件 9 字段（005） */
export type EventKind = "action" | "fact" | "status_transition" | "rumor_injection";

export interface LedgerEvent {
  /** 全局单调递增 seq（append-only 定序） */
  seq: number;
  /** ISO 时间戳 */
  ts: string;
  /** 提交者角色名 */
  actor: string;
  /** 事件类型 */
  kind: EventKind;
  /** 指向 schema 量纲/事实条目 */
  fact_ref: string;
  /** 结算值（引擎输出或叙事提议，canon:false 时为旁支值） */
  value: unknown;
  /** 正典状态 */
  canon_status: "canon" | "provisional" | "rumor";
  /** 世界书依据引用（三级锚） */
  worldbook_citation?: {
    section: string;
    para_hash: string;
    prefix: string;
  };
  /** 传播半径：哪些角色能看到此事件（"all" = 公开层） */
  propagation_radius: string[] | "all";
  /** 因果引用：指向哪条正典 seq */
  cause_ref?: number;
}

/** 账本旁支条目（004 Q4：canon:false 侧 partition） */
export interface SideBranchEvent extends LedgerEvent {
  canon: false;
  reason_code: "worldbook_conflict" | "concurrent_override" | "out_of_rule";
  /** LLM advisory 分类（仅叙事矛盾时填） */
  classification?: "rumor" | "side_worldline" | "unresolved";
  /** 指向被覆盖正典条目的 seq */
  supersedes_ref?: number;
  related_parties: string[];
  rumor_injection?: {
    target: string | string[];
    perspective: string;
    blur_level: "none" | "high" | "max";
  };
}

/** 事实条目（005） */
export interface FactEntry {
  fact_id: string;
  subject: string;
  value: unknown;
  canon_status: "canon" | "provisional" | "rumor";
  who_can_see: string[] | "all";
  worldbook_citation?: {
    section: string;
    para_hash: string;
    prefix: string;
  };
  derived_from?: number[]; // 账本 seq 引用
}

/** KnownSet 物化视图（005）：KnownSet[role] = ∪(propagation_radius∋role 事件) ∪ (who_can_see∋role 事实) */
export interface KnownSetEntry {
  /** 事件或事实标识 */
  ref: string;
  /** 模糊度（005 Q4 三档表，MVP 只 none+max） */
  blur_level: "none" | "high" | "max";
  /** 视角描述（缺席简报用） */
  description: string;
}

/** 面板三层（006） */
export interface PanelLayer {
  public?: Record<string, unknown>;
  private?: Record<string, unknown>;
  rumor?: Record<string, { description: string; blur_level: "none" | "high" | "max" }>;
}

/** 面板视图（服务端下发，已按角色裁剪） */
export interface PanelView {
  role: string;
  as_of_seq: number;
  layers: PanelLayer;
  schema_version: string;
}

/** schema 基元（003 最小可用子集：quantity / formula / state_machine） */
export interface Quantity {
  name: string;
  unit?: string;
  range: { min: number; max: number };
  cap?: number;
  citations?: { section: string; para_hash: string; prefix: string }[];
}

export interface Formula {
  name: string;
  expression: string;
  input_quantities: string[];
  cap?: number;
  citations?: { section: string; para_hash: string; prefix: string }[];
}

export interface StateMachine {
  name: string;
  states: string[];
  transitions: {
    from: string;
    to: string;
    guard: string;
    probability?: number;
  }[];
  citations?: { section: string; para_hash: string; prefix: string }[];
}

export interface SchemaDef {
  schema_version: string;
  quantities: Quantity[];
  formulas: Formula[];
  state_machines: StateMachine[];
}

/** schema 验证结果 */
export type Verdict =
  | { ok: true; schema: SchemaDef; suspect?: boolean }
  | { ok: false; errors: string[] };

/** 结算结果（引擎唯一输出） */
export interface Settlement {
  seq: number;
  ts: string;
  actor: string;
  /** 结算后的量纲 → 值映射 */
  result: Record<string, unknown>;
  /** 命中的 state_machine 迁移（如有） */
  transition?: { from: string; to: string; guard: string; probability?: number };
  /** 是否触发 event_hook */
  triggered?: string[];
  /** schema 版本标签（003 Q5a） */
  schema_version: string;
  /** 如果 schema 在验证失败期，带 suspect 标签 */
  suspect?: boolean;
}

/** 账本：append-only 事件流 + 旁支 partition */
export interface Ledger {
  /** 正典事件（seq 升序） */
  events: LedgerEvent[];
  /** 旁支事件（canon:false） */
  sideBranches: SideBranchEvent[];
  /** 事实条目 */
  facts: FactEntry[];
  /** 叙事提议（proposals partition，002 决议②） */
  proposals: ProposalEntry[];
  /** 物化视图：KnownSet[role] */
  knownSets: Map<string, KnownSetEntry[]>;
  /** 当前全局 seq */
  seqCounter: number;
}

/** 叙事提议条目（proposals partition，002 决议②：不写结算值，仅记录 LLM 提议） */
export interface ProposalEntry {
  /** 账本当前 seq（写入时快照） */
  at_seq: number;
  ts: string;
  role: string;
  narrative: string;
  suggested_value?: unknown;
  provider: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** 角色视图：panel_state[role] 物化快照（006） */
export interface PanelState {
  role: string;
  as_of_seq: number;
  /** 量纲 → 当前值 */
  quantities: Record<string, number>;
  /** 状态机当前态 */
  state_machines: Record<string, string>;
  /** 可见事实 */
  facts: FactEntry[];
  /** 传闻（rumor 层） */
  rumors: { description: string; blur_level: "none" | "high" | "max" }[];
}
