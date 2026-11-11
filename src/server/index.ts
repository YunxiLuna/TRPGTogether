// 共典 · 服务器入口（009 Q1：Node 单进程 + 纯浏览器）
// 从 repo 根运行：node dist/server/index.js

import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { join } from "node:path";
import { LedgerStore } from "../ledger.js";
import { parseSchema, type SchemaDef } from "../index.js";
import { settle } from "../interpreter.js";
import { buildPanelView } from "../knownset.js";
import { buildAbsenceBriefing } from "../briefing.js";
import { generateNarrative, classifyNarrativeConflict } from "../narrative.js";
import { providerFromEnv, createLlmProvider, type LlmProvider } from "../llm/types.js";
import { loadDotEnv, saveDotEnv } from "../env.js";

// 从项目根 .env 加载 LLM 配置（不覆盖已设的进程环境变量）
loadDotEnv();

const store = new LedgerStore();

// 009 Q3：服务器 1 处 LLM 网关（单房间共享缓存单点）
let llm: LlmProvider = createLlmProvider(providerFromEnv());
console.log(`LLM provider: ${llm.name}`);
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

// 009 Q1：纯浏览器客户端。web/ 为单页应用（无构建依赖），随 dist/server 同进程静态服务。
const WEB_DIR = pathJoin(process.cwd(), "web");

import type { ServerResponse } from "node:http";

function serveStatic(res: ServerResponse, pathname: string) {
  // SPA 路由兜底：/player/:role、/gm、/ 都回 index.html，客户端 JS 解析路由
  const filePath = pathJoin(WEB_DIR, "index.html");
  if (existsSync(filePath)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(filePath));
    return true;
  }
  return false;
}

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
    void (async () => {
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

    // 009 Q3 叙事层端点：POST /api/narrative/:role（叙事 LLM 主调用→proposals partition）
    const nm = path.match(/^\/api\/narrative\/([A-Za-z0-9_]+)$/);
    if (nm && req.method === "POST") {
      try {
        const data = JSON.parse(body || "{}");
        const proposal = await generateNarrative(llm, store, nm[1], {
          factRef: data.fact_ref,
          value: data.value,
          worldbookSlice: data.worldbookSlice,
        });
        const entry = store.addProposal({
          role: proposal.role,
          narrative: proposal.narrative,
          suggested_value: proposal.suggested_value ?? undefined,
          provider: proposal.provider,
          usage: proposal.usage,
        });
        return json({ ok: true, proposal: entry });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 400);
      }
    }

    // 004 Q4 叙事矛盾分类端点：POST /api/classify（advisory，不改正典值）
    if (path === "/api/classify" && req.method === "POST") {
      try {
        const data = JSON.parse(body || "{}");
        const result = await classifyNarrativeConflict(llm, data.first, data.second);
        return json({ ok: true, ...result });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 400);
      }
    }

    // LLM 配置：GET 读当前（key 打码）；POST 持久化到 .env 并热切换 provider（009 Q3 单点配置）
    if (path === "/api/config/llm" && req.method === "GET") {
      const cur = providerFromEnv();
      const masked = cur.kind === "openai-compatible"
        ? { provider: "openai-compatible", baseUrl: cur.baseUrl, apiKey: cur.apiKey ? cur.apiKey.slice(0, 4) + "…" + cur.apiKey.slice(-4) : "", model: cur.model ?? "gpt-4o-mini" }
        : { provider: "mock" };
      return json({ ok: true, current: masked, live: llm.name });
    }

    if (path === "/api/config/llm" && req.method === "POST") {
      try {
        const data = JSON.parse(body || "{}");
        const updates: Record<string, string> = {};
        if (data.provider === "openai-compatible") {
          updates.TRPG_LLM_PROVIDER = "openai-compatible";
          updates.TRPG_LLM_API_KEY = String(data.apiKey ?? "");
          updates.TRPG_LLM_BASE_URL = String(data.baseUrl ?? "https://api.openai.com/v1");
          if (data.model) updates.TRPG_LLM_MODEL = String(data.model);
        } else if (data.provider === "mock") {
          updates.TRPG_LLM_PROVIDER = "mock";
        } else {
          return json({ ok: false, error: 'provider 须为 "mock" 或 "openai-compatible"' }, 400);
        }
        saveDotEnv(updates);
        for (const [k, v] of Object.entries(updates)) process.env[k] = v;
        llm = createLlmProvider(providerFromEnv());
        console.log("LLM provider 热切换 →", llm.name);
        return json({ ok: true, live: llm.name });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 400);
      }
    }

    // 叙事提议查询：GET /api/proposals?role=A
    if (path === "/api/proposals" && req.method === "GET") {
      const qs = new URL(req.url ?? "", "http://localhost").searchParams;
      const role = qs.get("role") ?? undefined;
      return json(store.getProposals(role ? { role } : undefined));
    }

    // 非 API 路径 → 静态 SPA（009 Q1 浏览器路由 /player/:role、/gm）
    if (!path.startsWith("/api/") && serveStatic(res, path)) return;

    json({
      name: "共典 MVP",
      schema_version: schema.schema_version,
      roles: store.roles,
      seq: store.seq,
      endpoints: ["/api/panel/:role", "/api/briefing/:role", "/api/settle", "/api/ledger", "/api/narrative/:role", "/api/classify", "/api/proposals", "/api/config/llm"],
      llm: llm.name,
    });
    })();
  });
});

const PORT = 54272;
server.listen(PORT, "127.0.0.1", () => {
  console.log(`共典 MVP server → http://127.0.0.1:${PORT}`);
  console.log(`schema: ${schema.schema_version} (${schema.quantities.length} 量纲, ${schema.formulas.length} 公式, ${schema.state_machines.length} 状态机)`);
});
