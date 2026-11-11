// 共典 · 最小 .env 加载器（零依赖）
// 启动时从项目根目录读 .env，KEY=VALUE 逐行解析（不覆盖已存在的 process.env 值）。
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join as pathJoin } from "node:path";

export function loadDotEnv(): void {
  const p = pathJoin(process.cwd(), ".env");
  if (!existsSync(p)) return;
  const lines = readFileSync(p, "utf-8").split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    // strip optional quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

/** 把 TRPG_LLM_* 配置持久化到项目根 .env（保留其他行，替换/追加同名 key） */
export function saveDotEnv(updates: Record<string, string>): void {
  const p = pathJoin(process.cwd(), ".env");
  const existing = existsSync(p) ? readFileSync(p, "utf-8").split("\n") : [];
  const keySet = new Set(Object.keys(updates));
  const kept = existing.filter((l) => {
    const t = l.trim();
    if (!t || t.startsWith("#")) return true;
    const eq = t.indexOf("=");
    return eq > 0 && !keySet.has(t.slice(0, eq).trim());
  });
  kept.push("");
  for (const [k, v] of Object.entries(updates)) kept.push(k + "=" + (v.includes(" ") ? JSON.stringify(v) : v));
  writeFileSync(p, kept.join("\n") + "\n");
}
