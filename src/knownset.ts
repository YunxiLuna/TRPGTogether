// 共典 · KnownSet 物化视图 + 面板三层裁剪
// 对齐 docs/spec/共典/005-信息不对称.md、006-面板契约三层.md

import type {
  KnownSetEntry,
  PanelView,
  PanelLayer,
  PanelState,
  FactEntry,
} from "./types.js";
import type { LedgerStore } from "./ledger.js";

/** 006 Q2：从 KnownSet 裁剪出角色 panel_view（三层，私有不留占位） */
export function buildPanelView(
  store: LedgerStore,
  role: string,
  schema_version: string,
): PanelView {
  const ks = store.getKnownSet(role);
  const layers: PanelLayer = {};

  // 公开层：blur=none 且传播半径=all 的事件
  const publicLayer: Record<string, unknown> = {};
  const privateLayer: Record<string, unknown> = {};
  const rumorLayer: Record<string, { description: string; blur_level: "none" | "high" | "max" }> = {};

  for (const entry of ks) {
    // ref 格式：ev_N / fact_N / rumor_N
    if (entry.ref.startsWith("ev_")) {
      const seq = parseInt(entry.ref.slice(3), 10);
      const ev = store.getEventBySeq(seq);
      if (!ev) continue;
      if (entry.blur_level === "none" && ev.propagation_radius === "all") {
        publicLayer[ev.fact_ref] = ev.value;
      } else if (entry.blur_level === "none" && Array.isArray(ev.propagation_radius) && ev.propagation_radius.includes(role)) {
        privateLayer[ev.fact_ref] = ev.value;
      } else if (entry.blur_level === "max") {
        rumorLayer[ev.fact_ref] = {
          description: entry.description,
          blur_level: "max",
        };
      }
    } else if (entry.ref.startsWith("rumor_")) {
      const seq = parseInt(entry.ref.slice(6), 10);
      const sb = store.getSideBranches().find((s) => s.seq === seq);
      if (sb && sb.rumor_injection) {
        rumorLayer[sb.fact_ref] = {
          description: entry.description,
          blur_level: "max",
        };
      }
    }
    // fact_N 进 private/rumor（按 who_can_see 已过滤过）
  }

  if (Object.keys(publicLayer).length > 0) layers.public = publicLayer;
  if (Object.keys(privateLayer).length > 0) layers.private = privateLayer;
  if (Object.keys(rumorLayer).length > 0) layers.rumor = rumorLayer;

  return {
    role,
    as_of_seq: store.seq,
    layers,
    schema_version,
  };
}

/** 006：panel_state[role] 物化快照（增量刷，O(1) 读 as_of_seq） */
export function buildPanelState(
  store: LedgerStore,
  role: string,
  schema: { quantities: { name: string; range: { min: number; max: number } }[]; state_machines: { name: string }[] },
): PanelState {
  const ks = store.getKnownSet(role);
  const quantities: Record<string, number> = {};
  const state_machines: Record<string, string> = {};
  const rumors: { description: string; blur_level: "none" | "high" | "max" }[] = [];

  // 从事件流中找最新值（seq 升序，后写覆盖前写）
  const events = store.getEvents();
  for (const ev of events) {
    if (!isKnownSetVisible(ks, ev.seq)) continue;
    if (typeof ev.value === "number" || typeof ev.value === "string") {
      const q = schema.quantities.find((qq) => qq.name === ev.fact_ref);
      if (q) {
        if (typeof ev.value === "number") quantities[ev.fact_ref] = ev.value;
      }
      // state machine
      const sm = schema.state_machines.find((smm) => smm.name === ev.fact_ref);
      if (sm && typeof ev.value === "string") state_machines[ev.fact_ref] = ev.value;
    }
  }

  // rumors
  for (const entry of ks) {
    if (entry.blur_level === "max") {
      rumors.push({ description: entry.description, blur_level: "max" });
    }
  }

  return {
    role,
    as_of_seq: store.seq,
    quantities,
    state_machines,
    facts: store.getFacts().filter((f) => isFactVisible(ks, f)),
    rumors,
  };
}

function isKnownSetVisible(ks: KnownSetEntry[], seq: number): boolean {
  return ks.some((k) => k.ref === `ev_${seq}` && k.blur_level !== "max");
}

function isFactVisible(ks: KnownSetEntry[], f: FactEntry): boolean {
  return ks.some((k) => k.ref === f.fact_id && k.blur_level !== "max");
}
