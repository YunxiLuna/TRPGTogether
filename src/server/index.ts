// 共典 · 服务器入口（009 Q1：Node 单进程 + 纯浏览器）
// 从 repo 根运行：node dist/server/index.js

import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LedgerStore } from "../ledger.js";
import { parseSchema, type SchemaDef } from "../index.js";
import { settle } from "../interpreter.js";
import { buildPanelView } from "../knownset.js";
import { buildAbsenceBriefing } from "../briefing.js";

const store = new LedgerStore();
store.registerRole("GM");
store.registerRole("A");
store.registerRole("B");

function loadSchema(): SchemaDef {
  const candidates = [
    join(process.cwd(), "test", "fixtures", "xiuxian-breakthrough.yaml"),
    join(process.cwd(), "dist", "..", "test", "fixtures", "xiuxian-breakthrough.yaml"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      const verdict = parseSchema(readFileSync(c, "utf-8"));
      if (verdict.ok) return verdict.schema;
      console.error("schema 验证失败:", verdict.errors);
    }
  }
  console.error("找不到 xiuxian-breakthrough.yaml，请从 repo 根运行");
  process.exit(1);
}

const schema = loadSchema();

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const path = (req.url ?? "/").split("?")[0];
  let body = "";
  req.on("data", (c: Buffer) => (body += c));
  req.on("end", () => {
    const json = (o: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(o, null, 2));
    };

    const pm = path.match(/^\/api\/panel\/([A-Za-z0-9_]+)$/);
    if (pm && req.method === "GET") {
      return json(buildPanelView(store, pm[1], schema.schema_version));
    }

    const bm = path.match(/^\/api\/briefing\/([A-Za-z0-9_]+)$/);
    if (bm && req.method === "GET") {
      return json(buildAbsenceBriefing(store, bm[1], 1, store.seq));
    }

    if (path === "/api/settle" && req.method === "POST") {
      try {
        const data = JSON.parse(body || "{}");
        const result = settle({
          actor: data.actor,
          kind: data.kind ?? "action",
          fact_ref: data.fact_ref,
          inputs: data.inputs ?? {},
          currentState: data.currentState,
          schema,
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
          return json({ ok: true, seq: ev.seq, result: result.settlement.result });
        }
        return json({ ok: false, reason: result.reason });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 400);
      }
    }

    if (path === "/api/ledger" && req.method === "GET") {
      return json(store.export());
    }

    json({
      name: "共典 MVP",
      schema_version: schema.schema_version,
      roles: store.roles,
      seq: store.seq,
      endpoints: ["/api/panel/:role", "/api/briefing/:role", "/api/settle", "/api/ledger"],
    });
  });
});

const PORT = 54272;
server.listen(PORT, "127.0.0.1", () => {
  console.log(`共典 MVP server → http://127.0.0.1:${PORT}`);
  console.log(`schema: ${schema.schema_version} (${schema.quantities.length} 量纲, ${schema.formulas.length} 公式, ${schema.state_machines.length} 状态机)`);
});
