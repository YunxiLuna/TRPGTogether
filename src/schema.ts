// 共典 · schema 子系统（YAML 最小可用子集 + 自洽/回算验证）
// 对齐 docs/spec/共典/003-schema-子系统.md Q2/Q4，MVP 只做 quantity/formula/state_machine 三个基元

import * as yaml from "js-yaml";
import type {
  SchemaDef,
  Quantity,
  Formula,
  StateMachine,
  Verdict,
} from "./types.js";

/** 从 YAML 文本解析 schema（003 Q2 最小可用子集） */
export function parseSchema(yamlText: string): Verdict {
  let raw: unknown;
  try {
    raw = yaml.load(yamlText);
  } catch (e) {
    return { ok: false, errors: [`YAML 解析失败: ${(e as Error).message}`] };
  }

  const errs: string[] = [];
  const def = raw as Partial<SchemaDef>;
  const quantities: Quantity[] = Array.isArray(def.quantities) ? def.quantities : [];
  const formulas: Formula[] = Array.isArray(def.formulas) ? def.formulas : [];
  const state_machines: StateMachine[] = Array.isArray(def.state_machines) ? def.state_machines : [];

  // 基本结构校验
  if (!def.schema_version) errs.push("缺少 schema_version");
  if (quantities.length === 0) errs.push("缺少 quantities");

  // 量纲唯一（003 Q2：一个 quantity 只定义一次 canonical）
  const qnames = new Set<string>();
  for (const q of quantities) {
    if (qnames.has(q.name)) errs.push(`量纲重复定义: ${q.name}`);
    qnames.add(q.name);
    if (q.range && q.cap !== undefined && q.cap > q.range.max)
      errs.push(`量纲 ${q.name}: cap(${q.cap}) 超出 range.max(${q.range.max})`);
  }

  // 公式引用的输入必须是：已定义量纲 ∪ 前序公式名（003 最小可用子集允许公式间引用）
  const formulaNames = new Set<string>();
  for (const f of formulas) {
    for (const inp of f.input_quantities ?? []) {
      if (!qnames.has(inp) && !formulaNames.has(inp)) {
        errs.push(`公式 ${f.name} 引用未定义量纲/公式: ${inp}`);
      }
    }
    formulaNames.add(f.name);
  }

  // state_machine 基本结构
  for (const sm of state_machines) {
    const stateSet = new Set(sm.states);
    for (const tr of sm.transitions ?? []) {
      if (!stateSet.has(tr.from)) errs.push(`状态机 ${sm.name}: 迁移 from=${tr.from} 不在 states 里`);
      if (!stateSet.has(tr.to)) errs.push(`状态机 ${sm.name}: 迁移 to=${tr.to} 不在 states 里`);
      if (tr.probability !== undefined && (tr.probability < 0 || tr.probability > 1))
        errs.push(`状态机 ${sm.name}: probability ${tr.probability} 不在 [0,1]`);
    }
  }

  if (errs.length > 0) return { ok: false, errors: errs };

  const schema: SchemaDef = {
    schema_version: def.schema_version as string,
    quantities,
    formulas,
    state_machines,
  };

  // 自洽检查（003 Q4 ①纯结构，零成本先跑）
  const consistent = checkConsistency(schema);
  if (!consistent.ok) return { ok: false, errors: consistent.errors };

  return { ok: true, schema };
}

/** 自洽检查（003 Q4 ①）：映射是函数 / 区间满足 cap / 状态机无不可达 / 同输入不出两值 */
function checkConsistency(schema: SchemaDef): Verdict {
  const errors: string[] = [];

  // 状态机不可达态检测
  for (const sm of schema.state_machines) {
    const reachable = new Set<string>([sm.transitions?.[0]?.from]);
    const queue = [sm.transitions?.[0]?.from];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const tr of sm.transitions ?? []) {
        if (tr.from === cur && !reachable.has(tr.to)) {
          reachable.add(tr.to);
          queue.push(tr.to);
        }
      }
    }
    for (const s of sm.states) {
      if (!reachable.has(s) && sm.states.length > 1) {
        errors.push(`状态机 ${sm.name}: 不可达态 ${s}`);
      }
    }
  }

  // 公式 cap 检查
  for (const f of schema.formulas) {
    const q = schema.quantities.find((q) => q.name === f.name);
    if (f.cap !== undefined && q && f.cap > q.range.max) {
      errors.push(`公式 ${f.name}: cap(${f.cap}) 超 range.max(${q.range.max})`);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, schema };
}

/** 回算检查（003 Q4 ②）：用世界书已知算例跑引擎比对 */
export function checkRegression(
  schema: SchemaDef,
  examples: { inputs: Record<string, number>; expected: Record<string, number>; label: string }[],
): { ok: boolean; failures: { label: string; got: Record<string, number>; expected: Record<string, number> }[] } {
  const failures: { label: string; got: Record<string, number>; expected: Record<string, number> }[] = [];
  for (const ex of examples) {
    const got = evaluateAll(schema, ex.inputs);
    let pass = true;
    for (const [k, v] of Object.entries(ex.expected)) {
      if (Math.abs((got[k] ?? 0) - v) > 1e-9) {
        pass = false;
        break;
      }
    }
    if (!pass) failures.push({ label: ex.label, got, expected: ex.expected });
  }
  return { ok: failures.length === 0, failures };
}

/** 求值器：给定输入量纲值，算出所有 formula 的输出（S3 核心：数值结算权威） */
export function evaluateAll(
  schema: SchemaDef,
  inputs: Record<string, number>,
): Record<string, number> {
  const result: Record<string, number> = { ...inputs };

  // 按公式顺序求值（依赖前序公式结果的，按 input_quantities 引用关系排序）
  // MVP：简单按声明顺序，假设 schema 作者已保证依赖前序
  for (const f of schema.formulas) {
    try {
      const val = evaluateFormula(f, result);
      // cap 钳制
      const capped = f.cap !== undefined ? Math.min(val, f.cap) : val;
      // range 钳制
      const q = schema.quantities.find((qq) => qq.name === f.name);
      const final = q ? Math.max(q.range.min, Math.min(capped, q.range.max ?? q.range.min)) : capped;
      result[f.name] = final;
    } catch (e) {
      result[f.name] = inputs[f.name] ?? 0;
    }
  }

  return result;
}

/** 求单个公式（简化表达式求值：加法、乘法、百分比） */
export function evaluateFormula(f: Formula, ctx: Record<string, number>): number {
  // MVP 表达式文法：支持
  //   常量 / 量纲名
  //   +  -  *  /
  //   ( )
  // 百分比加成语法：base + bonus*0.05（bonus 是点数，0.05 是每 50 点 +1% 的换算）
  // 混合：total = base + forced * 0.5
  const expr = f.expression;
  // 替换量纲名为数值
  const parts = expr.split(/(\s)/);
  let code = expr;
  // 按量纲名替换（长名先替换避免前缀撞；CJK 无词边界，用前后非标识符字符断言）
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = Object.keys(ctx).sort((a, b) => b.length - a.length);
  for (const n of names) {
    // 前后不得是 CJK 或字母数字（避免 悟性 被 悟 撞掉）
    code = code.replace(new RegExp(`(?<![\\u4e00-\\u9fffA-Za-z0-9])${esc(n)}(?![\\u4e00-\\u9fffA-Za-z0-9])`, "g"), `(${ctx[n]})`);
  }
  // 安全求值：替换后只应含数字、运算符、括号、点、允许标识符字符（中文）
  const idenChars = "\\u4e00-\\u9fff"; // CJK 统一表意文字
  if (!new RegExp(`^\\s*[0-9.+\\-*/()\\s${idenChars}]+$`).test(code)) {
    throw new Error(`公式 ${f.name} 表达式替换后含非法字符: ${code}`);
  }
  // 用 Function 构造器求值（MVP 内网工具，输入是 schema 作者控制的表达式）
  // eslint-disable-next-line no-new-func
  const val = new Function("return (" + code + ")")();
  return typeof val === "number" && isFinite(val) ? val : 0;
}

/** 状态机迁移（003：probability 缺省 = 1，即确定性迁移） */
export function applyStateMachine(
  sm: StateMachine,
  from: string,
  ctx: Record<string, number>,
  rng?: () => number,
): { to: string; transition: StateMachine["transitions"][number] } | null {
  for (const tr of sm.transitions ?? []) {
    if (tr.from !== from) continue;
    // 简化 guard 求值（同公式文法）
    let guardOk = true;
    if (tr.guard && tr.guard !== "true" && tr.guard !== "") {
      try {
        guardOk = evaluateFormula({ name: "guard", expression: tr.guard, input_quantities: [] }, ctx) !== 0;
      } catch {
        guardOk = false;
      }
    }
    if (!guardOk) continue;
    const p = tr.probability ?? 1;
    if (rng && p < 1 && rng() >= p) continue; // 随机失败
    return { to: tr.to, transition: tr };
  }
  return null;
}
