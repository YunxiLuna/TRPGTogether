// 共典 · 服务器入口（009 Q1：Node 单进程 + 纯浏览器）
// MVP：最小 API 服务，玩家连 127.0.0.1:xxxx
// 对齐 009 Q2 房间模型、Q3 LLM 唯一网关（MVP 未实装 LLM 调用路径）

import http from "node:http";
import { LedgerStore } from "../ledger.js";
import { parseSchema } from "../schema.js";
import { settle } from "../interpreter.js";
import { buildPanelView } from "../knownset.js";
import { buildAbsenceBriefing } from "../briefing.js";
import { readFileSync } from "node:fs";

// ---- MVP 单房间（009 Q2：1 部署实例 = 1 世界） ----
const store = new LedgerStore();
store.registerRole("GM");
store.registerRole("A");
store.registerRole("B");

// 加载修仙大千突破成功率 schema
const schemaText = readFileSync(
  new URL("../../test/fixtures/xiuxian-breakthrough.yaml", import.meta.url),
  "utf-8",
);
const schemaVerdict = parseSchema(schemaText);
if (!schemaVerdict.ok) {
  console.error("schema 解析失败:", (schemaVerdict as { errors: string[] }).errors);
  process.exit(1);
}
const schema = (schemaVerdict as { schema: { schema_version: string; quantities: unknown[]; formulas: unknown[]; state_machines: unknown[] } }).schema;

const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
  // CORS（纯浏览器连本地服务器）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;

  // 读 body
  let body = "";
  req.on("data", (chunk: Buffer) => (body += chunk));
  req.on("end", () => {
    // /api/panel/:role — 取角色面板视图
    const panelMatch = path.match(/^\/api\/panel\/([A-Z]+)$/);
    if (panelMatch && req.method === "GET") {
      const role = panelMatch[1];
      const view = buildPanelView(store, role, schema.schema_version);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(view, null, 2));
      return;
    }

    // /api/briefing/:role — 缺席简报
    const briefMatch = path.match(/^\/api\/briefing\/([A-Z]+)$/);
    if (briefMatch && req.method === "GET") {
      const role = briefMatch[1];
      const briefing = buildAbsenceBriefing(store, role, 1, store.seq);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(briefing, null, 2));
      return;
    }

    // /api/settle — 提交行动，引擎结算
    if (path === "/api/settle" && req.method === "POST") {
      try {
        const data = JSON.parse(body || "{}");
        const result = settle({
          actor: data.actor,
          kind: data.kind ?? "action",
          fact_ref: data.fact_ref,
          inputs: data.inputs ?? {},
          currentState: data.currentState,
          schema: schema as Parameters<typeof settle>[0]["schema"],
        });
        if (result.settlement) {
          const ev = store.appendEvent({
            actor: result.settlement.actor,
            kind: "action",
            fact_ref: data.fact_ref,
            value: result.settlement.result,
            canon_status: "canon",
            propagation_radius: "all",
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, seq: ev.seq, result: result.settlement.result }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, reason: result.reason }));
        }
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
      }
      return;
    }

    // /api/ledger — 全量导出（GM 权限，MVP 简化无鉴权）
    if (path === "/api/ledger" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(store.export(), null, 2));
      return;
    }

    // / — 根
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      name: "共典 MVP",
      version: schema.schema_version,
      roles: store.roles,
      seq: store.seq,
      endpoints: ["/api/panel/:role", "/api/briefing/:role", "/api/settle", "/api/ledger"],
    }));
  });
});

const PORT = 54272; // 避免与 DSH GUI 54271 撞
server.listen(PORT, "127.0.0.1", () => {
  console.log(`共典 MVP server → http://127.0.0.1:${PORT}`);
  console.log(`schema: ${schema.schema_version} (${(schema as { quantities: unknown[] }).quantities.length} 量纲, ${(schema as { formulas: unknown[] }).formulas.length} 公式, ${(schema as { state_machines: unknown[] }).state_machines.length} 状态机)`);
});
