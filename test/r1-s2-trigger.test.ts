// R1 风险验证（009 Q6 早期验证）：属性复杂世界书（斗罗）S2 逃生门触发率统计
// 对齐 docs/spec/共典/009-客户端与部署.md 风险卡片 1。
// MVP 的 schema 生成 = 人工/LLM 转写 6 基元最小可用子集；本测试把转写判定固化成
// catalog（test/fixtures/doulou-s2-catalog.yaml），断言触发率落在 009 R1 高区（>=30%）。

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import * as yaml from "js-yaml";

interface S2Catalog {
  systems: { name: string; expressible: boolean; why: string }[];
  stats: { total: number; s2_required: number; expressible: number; s2_trigger_rate: string };
  verdict: { threshold_low: string; threshold_high: string; observed: string; conclusion: string };
}

test("R1: 斗罗世界书 S2 触发率 >=30%（高区，6 基元表达力不足）", () => {
  const raw = readFileSync(new URL("./fixtures/doulou-s2-catalog.yaml", import.meta.url), "utf-8");
  const doc = yaml.load(raw) as S2Catalog;
  const systems = doc.systems;
  const s2 = systems.filter((s) => !s.expressible).length;
  const rate = s2 / systems.length;

  // catalog 内部统计自洽
  assert.equal(doc.stats.total, systems.length);
  assert.equal(doc.stats.s2_required, s2);

  // 009 R1 判定：>=30% = 表达力真不够
  assert.ok(rate >= 0.3, "触发率应落在高区(>=30%)，实际 " + (rate * 100).toFixed(1) + "%");
});

test("R1: catalog 每个体系都带 why 判定依据（防裸标记）", () => {
  const raw = readFileSync(new URL("./fixtures/doulou-s2-catalog.yaml", import.meta.url), "utf-8");
  const doc = yaml.load(raw) as S2Catalog;
  for (const s of doc.systems) {
    assert.ok(s.why && s.why.length > 10, s.name + " 缺判定依据");
  }
});
