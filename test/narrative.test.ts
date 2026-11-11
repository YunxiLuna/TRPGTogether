// 共典 · 叙事层 + proposals partition 测试（009 Q3 + 002 决议②）
import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerStore } from "../src/ledger.js";
import { generateNarrative, classifyNarrativeConflict } from "../src/narrative.js";
import { MockProvider } from "../src/llm/mock.js";

function freshStore(): LedgerStore {
  const store = new LedgerStore();
  store.registerRole("GM");
  store.registerRole("A");
  store.registerRole("B");
  store.appendEvent({
    actor: "A",
    kind: "action",
    fact_ref: "悟性",
    value: 100,
    canon_status: "canon",
    propagation_radius: "all",
  });
  return store;
}

test("generateNarrative：mock provider 下全链路（proposals partition，不写结算值）", async () => {
  const store = freshStore();
  const llm = new MockProvider(42);

  const before = store.export();
  const proposal = await generateNarrative(llm, store, "A", { factRef: "突破成功率", value: "混合总成功率" });

  // 叙事文案非空
  assert.ok(proposal.narrative.length > 0, "narrative 非空");
  assert.equal(proposal.role, "A");
  assert.equal(proposal.provider, "mock");
  assert.ok(proposal.usage.outputTokens > 0, "usage 记录");

  // 入账 proposals partition
  const entry = store.addProposal({
    role: proposal.role,
    narrative: proposal.narrative,
    suggested_value: proposal.suggested_value ?? undefined,
    provider: proposal.provider,
    usage: proposal.usage,
  });
  assert.equal(entry.at_seq, 1, "at_seq = 当前 seq（快照）");

  // 叙事不写结算值：正典 events 不变
  const after = store.export();
  assert.equal(after.events.length, before.events.length, "叙事不改正典 events 长度");
  assert.equal(after.events[0].value, 100, "叙事不改正典 events 值");
  assert.equal(after.proposals.length, 1, "proposals 记账 1 条");
  assert.equal(after.proposals[0].narrative, proposal.narrative);
});

test("getProposals：按 role 过滤", async () => {
  const store = freshStore();
  const llm = new MockProvider(7);

  const p1 = await generateNarrative(llm, store, "A", { factRef: "悟性" });
  store.addProposal({
    role: p1.role,
    narrative: p1.narrative,
    provider: p1.provider,
    usage: p1.usage,
  });

  const p2 = await generateNarrative(llm, store, "B", { factRef: "气运" });
  store.addProposal({
    role: p2.role,
    narrative: p2.narrative,
    provider: p2.provider,
    usage: p2.usage,
  });

  assert.equal(store.getProposals().length, 2);
  assert.equal(store.getProposals({ role: "A" }).length, 1);
  assert.equal(store.getProposals({ role: "B" }).length, 1);
  assert.equal(store.getProposals({ role: "C" }).length, 0, "无此角色返回空");
});

test("export/restore：proposals partition 随存档恢复", async () => {
  const store = freshStore();
  const llm = new MockProvider(99);
  const p = await generateNarrative(llm, store, "A", { factRef: "悟性" });
  store.addProposal({
    role: p.role,
    narrative: p.narrative,
    provider: p.provider,
    usage: p.usage,
  });

  const data = store.export();
  const restored = LedgerStore.restore(data);
  assert.equal(restored.getProposals().length, 1, "restore 恢复 proposals");
  assert.equal(restored.getProposals()[0].narrative, p.narrative);
});

test("classifyNarrativeConflict：mock 下保守归类（advisory，不改数值定序）", async () => {
  const llm = new MockProvider(42);
  // mock 的 system prompt 不含 label=rumor/label=side_worldline，归 unresolved
  const result = await classifyNarrativeConflict(
    llm,
    { actor: "A", fact_ref: "悟性", value: 100 },
    { actor: "B", fact_ref: "悟性", value: 200 },
  );
  assert.equal(result.classification, "unresolved", "默认保守归未决");

  // 数值定序仍由引擎 seq 机械决定（分类不改写）
  const store = freshStore();
  const before = store.export().events[0].value;
  assert.equal(before, 100, "分类不改正典值");
});
