// 共典 · 结算解释器（S3 混合分层：数值结算权威 = 声明式解释器）
// 对齐 docs/spec/共典/002-整体架构.md（S3 决议）、004-引擎权威性.md

import type {
  LedgerEvent,
  SideBranchEvent,
  SchemaDef,
  Settlement,
} from "./types.js";
import { LedgerStore } from "./ledger.js";
import { evaluateAll, applyStateMachine } from "./schema.js";

export interface SettlementRequest {
  /** 提交者角色 */
  actor: string;
  /** 行动类型 */
  kind: "action" | "status_transition";
  /** 关联 schema 量纲/公式/状态机（fact_ref） */
  fact_ref: string;
  /** 行动参数（输入量纲值） */
  inputs: Record<string, number>;
  /** 当前状态机状态（如果 fact_ref 指向状态机） */
  currentState?: string;
  /** schema 快照（只读版本，003 Q5a） */
  schema: SchemaDef;
  /** 随机数源（可注入，测试时给固定序列） */
  rng?: () => number;
}

export interface SettlementResult {
  /** 结算成功：正典事件 */
  settlement?: Settlement;
  /** 冲突：旁支事件（004 Q4 先正典后旁支） */
  sideBranch?: SideBranchEvent;
  /** 是否需要写入账本 */
  write: boolean;
  /** 人类可读说明 */
  reason?: string;
}

/**
 * 结算解释器：给定 schema 快照 + 输入，产出 Settlement
 * 单一结算写者（004 Q4 机制载体①）
 */
export function settle(req: SettlementRequest): SettlementResult {
  const { schema, actor, kind, fact_ref, inputs, currentState, rng } = req;

  // 求值所有公式
  const values = evaluateAll(schema, inputs);

  // 查找 fact_ref 指向的状态机，尝试迁移
  let transition;
  const mutableValues: Record<string, unknown> = { ...values };
  if (currentState) {
    const sm = schema.state_machines.find((s) => s.name === fact_ref);
    if (sm) {
      transition = applyStateMachine(sm, currentState, mutableValues as Record<string, number>, rng);
      if (transition) {
        mutableValues[`sm_${sm.name}_state`] = transition.to;
      }
    }
  }

  const settlement: Settlement = {
    seq: 0, // 由账本层填写
    ts: new Date().toISOString(),
    actor,
    result: mutableValues,
    transition: transition?.transition,
    triggered: undefined,
    schema_version: schema.schema_version,
  };

  return { settlement, write: true };
}

/**
 * 账本层仲裁（004 Q4）：两人同时声称矛盾之事
 * 先提交者正典、后提交者旁支
 */
export function arbitrate(
  store: LedgerStore,
  first: LedgerEvent,
  second: Omit<SideBranchEvent, "seq" | "ts">,
): SideBranchEvent {
  const sideBranch: SideBranchEvent = {
    ...second,
    seq: store.seq + 1,
    ts: new Date().toISOString(),
    canon: false,
    supersedes_ref: first.seq,
  };
  return sideBranch;
}

/**
 * 世界书矛盾检测（004 Q1 例外 1）：
 * 同量纲出现双值 → 主源（消费公式数最多者）canon:true，争议值 canon:false
 */
export function detectWorldbookConflict(
  schema: SchemaDef,
  valueA: { quantity: string; value: number; citations: { section: string }[] },
  valueB: { quantity: string; value: number; citations: { section: string }[] },
): { canon: typeof valueA | typeof valueB; disputed: typeof valueA | typeof valueB; reason_code: string } {
  if (valueA.quantity !== valueB.quantity || valueA.value === valueB.value) {
    return { canon: valueA, disputed: valueB, reason_code: "none" };
  }
  // 消费公式数 = 被多少公式 input_quantities 引用
  const countA = schema.formulas.filter((f) => f.input_quantities?.includes(valueA.quantity)).length;
  const countB = schema.formulas.filter((f) => f.input_quantities?.includes(valueB.quantity)).length;
  if (countA > countB) return { canon: valueA, disputed: valueB, reason_code: "worldbook_conflict" };
  if (countB > countA) return { canon: valueB, disputed: valueA, reason_code: "worldbook_conflict" };
  // 平手 tie-break：先写（citations 章节序小者）
  const secA = valueA.citations[0]?.section ?? "999";
  const secB = valueB.citations[0]?.section ?? "999";
  return secA <= secB
    ? { canon: valueA, disputed: valueB, reason_code: "worldbook_conflict" }
    : { canon: valueB, disputed: valueA, reason_code: "worldbook_conflict" };
}
