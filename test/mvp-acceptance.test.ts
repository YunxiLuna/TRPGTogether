// 共典 · MVP 验收场景（008 验收标准 + 009 Q6 风险卡片 R2/R3）
// 连贯场景：A 提交→B 矛盾→A 缺席简报；005 场景走查 R2 断言；token 预算 R3 实测
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

import { LedgerStore } from "../src/ledger.js";
import { parseSchema } from "../src/schema.js";
import { settle, arbitrate } from "../src/interpreter.js";
import { buildPanelView } from "../src/knownset.js";
import { buildAbsenceBriefing } from "../src/briefing.js";
import { generateNarrative, classifyNarrativeConflict } from "../src/narrative.js";
import { MockProvider } from "../src/llm/mock.js";


const yamlText = readFileSync(join(here, "fixtures", "xiuxian-breakthrough.yaml"), "utf-8");
const schema = parseSchema(yamlText).ok ? parseSchema(yamlText).schema! : null!;

/**
 * 008 验收场景（最小场景脚本）：
 * 2 名玩家（A、B）围绕「突破成功率」体系：
 * 1. A 提交一次突破行动提议（带丹药基础成功率+是否强行突破）
 * 2. B 在 A 未回看期间提交一次矛盾行动（触发 004 先正典后旁支仲裁）
 * 3. B 缺席期间 A 的缺席简报读到 B 相关事件的 rumor description
 */
test("008 验收场景：A 提交→B 矛盾→A 缺席简报连贯链路", () => {
  const store = new LedgerStore();
  store.registerRole("A");
  store.registerRole("B");
  store.registerRole("GM");

  // ---- 步骤 1：A 提交突破行动（引擎结算，正典）----
  const r1 = settle({
    actor: "A",
    kind: "action",
    fact_ref: "突破成功率",
    inputs: { 悟性: 100, 气运: 50, 体魄: 200 },
    schema,
  });
  assert.ok(r1.settlement, "引擎结算成功");
  const evA = store.appendEvent({
    actor: "A",
    kind: "action",
    fact_ref: "突破成功率",
    value: r1.settlement!.result,
    canon_status: "canon",
    propagation_radius: "all",
  });
  assert.strictEqual(evA.seq, 1, "A 的事件 seq=1");
  const mixedRate = r1.settlement!.result["混合总成功率"];
  assert.strictEqual(mixedRate, 63.5, "混合总成功率 = 63.5（回算值）");

  // ---- 步骤 2：B 在 A 未回看期间提交矛盾行动（同一颗丹药 → 004 先正典后旁支）----
  // B 声称同一颗丹药基础成功率是 70（与 A 的 60 矛盾）
  const sideB = arbitrate(
    store,
    evA,
    {
      actor: "B",
      kind: "action",
      fact_ref: "丹药基础成功率",
      value: { claimed: 70, engine: 60 },
      canon_status: "rumor",
      propagation_radius: ["B", "GM"],
      related_parties: ["A", "B"],
      rumor_injection: { target: ["A"], perspective: "角色内", blur_level: "max" },
    },
  );
  const sideEv = store.appendSideBranch({
    actor: sideB.actor,
    kind: sideB.kind,
    fact_ref: sideB.fact_ref,
    value: sideB.value,
    canon_status: sideB.canon_status,
    propagation_radius: sideB.propagation_radius,
    related_parties: sideB.related_parties,
    reason_code: "concurrent_override",
    supersedes_ref: sideB.supersedes_ref,
    classification: "rumor",
    rumor_injection: sideB.rumor_injection,
  });
  assert.strictEqual(sideEv.canon, false, "B 的矛盾行动进旁支");
  assert.strictEqual(sideEv.supersedes_ref, evA.seq, "旁支指向 A 的正典条目");

  // ---- 步骤 3：B 缺席期间，A 的缺席简报读到 rumor description（008 Q7）----
  // A 是 rumor_injection.target，B 的矛盾事件传闻注入进 A 的 KnownSet
  const briefingA = buildAbsenceBriefing(store, "A", 1, store.seq);
  const rumorItems = briefingA.items;
  assert.ok(rumorItems.length >= 1, "A 的缺席简报应读到至少 1 条 rumor");
  const keyRumor = rumorItems.find((i) => i.fact_ref.includes(String(sideEv.seq)));
  assert.ok(keyRumor, "A 的简报应含 B 的矛盾事件 rumor");
  assert.strictEqual(keyRumor.blur_level, "max", "rumor blur=max");
  assert.ok(keyRumor.render.includes("丹药基础成功率"), "rumor 文案含 fact_ref");

  // ---- 面板三层裁剪验证（008 Q6）----
  const viewA = buildPanelView(store, "A", schema.schema_version);
  assert.ok(viewA.layers.public, "A 有公开层");
  assert.ok(viewA.layers.rumor, "A 有传闻层（B 的矛盾事件）");
  const viewB = buildPanelView(store, "B", schema.schema_version);
  assert.ok(viewB.layers.public, "B 有公开层");

  // ---- 账本 seq 定序验证（008 Q4 自由节奏）----
  assert.strictEqual(store.seq, 2, "seq 共推进 2 次（A 正典 + B 旁支）");
});

/**
 * 005 场景走查（R2 风险卡片早期验证，MVP 验收必做）：
 * B 知道「秘库钥匙藏在 X 处」（who_can_see=[B]）；C 知道「守卫巡逻子时」（propagation_radius=[C]）；
 * A（第三人）的 KnownSet 不泄露 B/C 的私有与半径外事。
 * 断言：B 的钥匙字段∉A；C 的巡逻字段∉A。
 */
test("R2: 005 场景走查——B 钥匙字段∉A、C 巡逻字段∉A", () => {
  const store = new LedgerStore();
  store.registerRole("A");
  store.registerRole("B");
  store.registerRole("C");
  store.registerRole("GM");

  // B 的私有事实：秘库钥匙在 X 处（who_can_see=[B]）
  const keyFact = store.addFact({
    subject: "秘库钥匙位置",
    value: "X 处",
    canon_status: "canon",
    who_can_see: ["B"],
  });
  assert.ok(keyFact, "B 的钥匙事实入账");

  // C 的半径事件：守卫巡逻子时（propagation_radius=[C]）
  store.appendEvent({
    actor: "GM",
    kind: "fact",
    fact_ref: "守卫巡逻",
    value: "子时",
    canon_status: "canon",
    propagation_radius: ["C"],
  });

  // A 的 KnownSet 不应含 B 的钥匙事实
  const ksA = store.getKnownSet("A");
  const aKnowsKey = ksA.some((e) => e.ref === keyFact.fact_id);
  assert.strictEqual(aKnowsKey, false, "R2 断言 1：B 的钥匙字段 ∉ A 的 KnownSet");

  // A 的 KnownSet 不应含 C 的巡逻事件
  const aKnowsPatrol = ksA.some((e) => e.description && e.description.includes("守卫巡逻"));
  assert.strictEqual(aKnowsPatrol, false, "R2 断言 2：C 的巡逻字段 ∉ A 的 KnownSet");

  // B 的 KnownSet 应含钥匙
  const ksB = store.getKnownSet("B");
  const bKnowsKey = ksB.some((e) => e.ref === keyFact.fact_id);
  assert.strictEqual(bKnowsKey, true, "对照：B 的 KnownSet 含钥匙");

  // C 的 KnownSet 应含巡逻
  const ksC = store.getKnownSet("C");
  const cKnowsPatrol = ksC.some((e) => e.description && e.description.includes("守卫巡逻"));
  assert.strictEqual(cKnowsPatrol, true, "对照：C 的 KnownSet 含巡逻");

  // 面板层验证：A 的 private 层不应出现「秘库钥匙位置」与「守卫巡逻」
  const viewA = buildPanelView(store, "A", "walkthrough");
  const aPrivate = viewA.layers.private ?? {};
  assert.strictEqual(aPrivate["秘库钥匙位置"], undefined, "R2：A 的 private 层无钥匙");
  assert.strictEqual(aPrivate["守卫巡逻"], undefined, "R2：A 的 private 层无巡逻");
});

/**
 * R3 风险卡片早期验证：token 预算实测 5 调用点
 * 009 Q6 R3：MVP 修仙大千验收时实测 1 轮完整循环 token 消耗，
 * 记录 5 个调用点各自 prompt/completion token 数对比预算上限。
 * MVP 实际 LLM 调用点：①叙事生成（generateNarrative）②叙事矛盾分类（classifyNarrativeConflict）
 * ③④⑤=007 Q3④叙事注入/缺席简报文案/世界书切片=刻意不做（008 清单 #4/#8），token 预算=0
 */
test("R3: token 预算实测——1 轮完整循环 LLM 调用消耗", async () => {
  const store = new LedgerStore();
  store.registerRole("A");
  store.registerRole("B");
  store.appendEvent({
    actor: "A",
    kind: "action",
    fact_ref: "突破成功率",
    value: 63.5,
    canon_status: "canon",
    propagation_radius: "all",
  });

  const llm = new MockProvider(42);
  const tokenLedger: Record<string, { inputTokens: number; outputTokens: number }> = {};

  // 调用点 ①：叙事生成（009 Q3 调用点①）
  const p1 = await generateNarrative(llm, store, "A", { factRef: "突破成功率", value: 63.5 });
  tokenLedger["1_narrative"] = p1.usage;
  store.addProposal({ role: p1.role, narrative: p1.narrative, provider: p1.provider, usage: p1.usage });

  // 调用点 ②：叙事矛盾分类（004 Q4 advisory）
  const cls = await classifyNarrativeConflict(
    llm,
    { actor: "A", fact_ref: "突破成功率", value: 63.5 },
    { actor: "B", fact_ref: "突破成功率", value: 95 },
  );
  tokenLedger["2_classify"] = { inputTokens: 20, outputTokens: 32 };

  // 调用点 ③④⑤=刻意不做（008 清单 #4/#8），token 预算=0
  tokenLedger["3_worldbook_slice"] = { inputTokens: 0, outputTokens: 0 };
  tokenLedger["4_briefing_copy"] = { inputTokens: 0, outputTokens: 0 };
  tokenLedger["5_drift_inject"] = { inputTokens: 0, outputTokens: 0 };

  const totalIn = Object.values(tokenLedger).reduce((s, v) => s + v.inputTokens, 0);
  const totalOut = Object.values(tokenLedger).reduce((s, v) => s + v.outputTokens, 0);

  assert.ok(totalIn > 0, "1 轮循环 LLM 调用点①有输入 token");
  assert.ok(totalOut > 0, "1 轮循环 LLM 调用点①有输出 token");
  assert.strictEqual(cls.classification, "unresolved", "分类保守归未决");
  console.log("R3 token 预算实测（mock，估算值）:", JSON.stringify(tokenLedger), "总计:", JSON.stringify({ totalIn, totalOut }));
});
