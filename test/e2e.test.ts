// 共典 MVP 验收测试（008 5 验证点）
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

import { LedgerStore } from "../src/ledger.js";
import { parseSchema, evaluateAll } from "../src/schema.js";
import { buildPanelView } from "../src/knownset.js";
import { buildAbsenceBriefing } from "../src/briefing.js";

const yamlText = readFileSync(join(here, "fixtures", "xiuxian-breakthrough.yaml"), "utf-8");

test("V1: schema 解析 + 自洽检查", () => {
  const verdict = parseSchema(yamlText);
  assert.ok(verdict.ok, "schema 应通过: " + JSON.stringify(verdict));
  const schema = verdict.ok ? verdict.schema : null!;
  const sm = schema.state_machines[0];
  assert.strictEqual(sm.states.length, 16);
  assert.strictEqual(sm.transitions.length, 15);
});

test("V1b: 回算——混合总成功率公式", () => {
  const verdict = parseSchema(yamlText);
  const schema = verdict.ok ? verdict.schema : null!;
  const inputs = { 悟性: 100, 气运: 50, 体魄: 200 };
  const result = evaluateAll(schema, inputs);
  assert.strictEqual(result["强行加成"], 7);
  assert.strictEqual(result["混合总成功率"], 63.5);
});

test("V1c: 回算——上限 cap", () => {
  const verdict = parseSchema(yamlText);
  const schema = verdict.ok ? verdict.schema : null!;
  const inputs = { 悟性: 10000, 气运: 10000, 体魄: 10000 };
  const result = evaluateAll(schema, inputs);
  assert.strictEqual(result["强行加成"], 15, "强行加成 cap=15");
});

test("V2: 面板三层裁剪", () => {
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

  store.appendEvent({
    actor: "A",
    kind: "fact",
    fact_ref: "悟性",
    value: 100,
    canon_status: "canon",
    propagation_radius: ["A", "GM"],
  });

  const verdict = parseSchema(yamlText);
  const schema = verdict.ok ? verdict.schema : null!;

  const viewA = buildPanelView(store, "A", schema.schema_version);
  const viewB = buildPanelView(store, "B", schema.schema_version);

  assert.ok(viewA.layers.public, "A 有公开层");
  assert.strictEqual(viewA.layers.public!["突破成功率"], 63.5);
  assert.ok(viewA.layers.private, "A 有私有层");
  assert.strictEqual(viewA.layers.private!["悟性"], 100);

  assert.ok(viewB.layers.public, "B 有公开层");
  assert.strictEqual(viewB.layers.public!["突破成功率"], 63.5);
  assert.strictEqual(viewB.layers.private, undefined, "B 不应有私有层");
});

test("V3: 账本 seq 定序", () => {
  const store = new LedgerStore();
  store.registerRole("A");
  store.registerRole("B");

  const e1 = store.appendEvent({ actor: "A", kind: "action", fact_ref: "突破", value: 1, canon_status: "canon", propagation_radius: "all" });
  const e2 = store.appendEvent({ actor: "B", kind: "action", fact_ref: "突破", value: 2, canon_status: "canon", propagation_radius: "all" });
  const e3 = store.appendEvent({ actor: "A", kind: "status_transition", fact_ref: "境界", value: "筑基", canon_status: "canon", propagation_radius: "all" });

  assert.strictEqual(e1.seq, 1);
  assert.strictEqual(e2.seq, 2);
  assert.strictEqual(e3.seq, 3);
  assert.strictEqual(store.seq, 3);
});

test("V4: 世界书矛盾 → canon:false 旁支 → rumor 层", () => {
  const store = new LedgerStore();
  store.registerRole("A");
  store.registerRole("B");
  store.registerRole("GM");

  const canonEvent = store.appendEvent({
    actor: "A",
    kind: "fact",
    fact_ref: "铁剑品级",
    value: 10,
    canon_status: "canon",
    propagation_radius: "all",
  });

  const sideEvent = store.appendSideBranch({
    actor: "B",
    kind: "fact",
    fact_ref: "铁剑品级",
    value: 15,
    canon_status: "rumor",
    canon: false,
    reason_code: "concurrent_override",
    classification: "rumor",
    supersedes_ref: canonEvent.seq,
    related_parties: ["B", "GM"],
    propagation_radius: ["B", "GM"],
    rumor_injection: {
      target: ["A"],
      perspective: "角色内",
      blur_level: "max",
    },
  });

  assert.strictEqual(sideEvent.canon, false);
  assert.strictEqual(sideEvent.reason_code, "concurrent_override");
  assert.strictEqual(sideEvent.supersedes_ref, canonEvent.seq);

  const ksA = store.getKnownSet("A");
  const rumorInKs = ksA.find((k) => k.ref === "rumor_" + sideEvent.seq);
  assert.ok(rumorInKs, "A 的 KnownSet 应有 rumor 条目");
  assert.strictEqual(rumorInKs!.blur_level, "max");

  const verdict = parseSchema(yamlText);
  const schema = verdict.ok ? verdict.schema : null!;
  const viewA = buildPanelView(store, "A", schema.schema_version);
  assert.ok(viewA.layers.rumor, "A 面板应有 rumor 层");
  assert.ok(viewA.layers.rumor!["铁剑品级"], "A 面板 rumor 层应有铁剑品级");
  assert.strictEqual(viewA.layers.rumor!["铁剑品级"]!.blur_level, "max");
});

test("V5: 缺席简报", () => {
  const store = new LedgerStore();
  store.registerRole("A");
  store.registerRole("B");
  store.registerRole("GM");

  const canonEv = store.appendEvent({
    actor: "A",
    kind: "action",
    fact_ref: "突破成功率",
    value: 63.5,
    canon_status: "canon",
    propagation_radius: "all",
  });

  store.appendSideBranch({
    actor: "A",
    kind: "action",
    fact_ref: "突破成功率",
    value: 95,
    canon_status: "rumor",
    canon: false,
    reason_code: "concurrent_override",
    supersedes_ref: canonEv.seq,
    related_parties: ["A", "B"],
    propagation_radius: ["A"],
    rumor_injection: {
      target: ["B"],
      perspective: "角色内",
      blur_level: "max",
    },
  });

  const briefing = buildAbsenceBriefing(store, "B", 1, store.seq);
  assert.strictEqual(briefing.target, "B");
  assert.strictEqual(briefing.items.length, 1, "B 应收到 1 条 rumor");
  assert.strictEqual(briefing.items[0].blur_level, "max");
  assert.strictEqual(briefing.items[0].perspective, "角色内");
  assert.ok(briefing.items[0].render.includes("突破成功率"), "简报文案应含 fact_ref");
});
