// 共典 · 账本层（append-only seq 定序 + 旁支 partition + 事实条目 + KnownSet 物化）
// 对齐 docs/spec/共典/005-信息不对称.md、004-引擎权威性.md

import type {
  LedgerEvent,
  SideBranchEvent,
  FactEntry,
  KnownSetEntry,
  Ledger,
} from "./types.js";

export class LedgerStore {
  private events: LedgerEvent[] = [];
  private sideBranches: SideBranchEvent[] = [];
  private facts: FactEntry[] = [];
  private knownSets = new Map<string, KnownSetEntry[]>();
  private seqCounter = 0;
  private roleSet = new Set<string>();

  /** 注册角色（首次出现时自动注册） */
  registerRole(role: string): void {
    this.roleSet.add(role);
    if (!this.knownSets.has(role)) this.knownSets.set(role, []);
  }

  get roles(): string[] {
    return [...this.roleSet];
  }

  get seq(): number {
    return this.seqCounter;
  }

  /** 追加正典事件 */
  appendEvent(
    ev: Omit<LedgerEvent, "seq" | "ts"> & { ts?: string },
  ): LedgerEvent {
    const seq = ++this.seqCounter;
    const ts = ev.ts ?? new Date().toISOString();
    const event: LedgerEvent = { ...ev, seq, ts };
    this.events.push(event);
    if (!this.roleSet.has(event.actor)) this.registerRole(event.actor);
    this._updateKnownSets(event);
    return event;
  }

  /** 追加旁支事件（canon:false，004 Q4） */
  appendSideBranch(
    ev: Omit<SideBranchEvent, "seq" | "ts" | "canon"> & { ts?: string },
  ): SideBranchEvent {
    const seq = ++this.seqCounter;
    const ts = ev.ts ?? new Date().toISOString();
    const event: SideBranchEvent = { ...ev, seq, ts, canon: false };
    this.sideBranches.push(event);
    if (!this.roleSet.has(event.actor)) this.registerRole(event.actor);
    this._updateKnownSets(event);
    // 旁支的 rumor_injection 目标角色也入 KnownSet
    const targets = Array.isArray(event.rumor_injection?.target)
      ? event.rumor_injection.target
      : [event.rumor_injection?.target];
    for (const t of targets) {
      if (t && this.roleSet.has(t)) {
        this._injectRumor(t, event);
      }
    }
    return event;
  }

  /** 追加事实条目 */
  addFact(fact: Omit<FactEntry, "fact_id"> & { fact_id?: string }): FactEntry {
    const fact_id = fact.fact_id ?? `fact_${this.facts.length + 1}`;
    const entry: FactEntry = { ...fact, fact_id };
    this.facts.push(entry);
    this._updateFactKnownSets(entry);
    return entry;
  }

  /** 正典事件（seq 升序） */
  getEvents(filter?: { actor?: string; kind?: string; fact_ref?: string }): LedgerEvent[] {
    return this.events.filter(
      (e) =>
        (!filter?.actor || e.actor === filter.actor) &&
        (!filter?.kind || e.kind === filter.kind) &&
        (!filter?.fact_ref || e.fact_ref === filter.fact_ref),
    );
  }

  /** 旁支事件（seq 升序） */
  getSideBranches(): SideBranchEvent[] {
    return [...this.sideBranches].sort((a, b) => a.seq - b.seq);
  }

  /** 单条事件按 seq 查 */
  getEventBySeq(seq: number): LedgerEvent | undefined {
    return this.events.find((e) => e.seq === seq);
  }

  getFacts(): FactEntry[] {
    return [...this.facts];
  }

  /** 取角色 KnownSet（物化视图） */
  getKnownSet(role: string): KnownSetEntry[] {
    return this.knownSets.get(role) ?? [];
  }

  /** 全量导出（可序列化到 YAML/JSONL 文件，009 Q2 存档） */
  export(): Omit<Ledger, "knownSets"> & { knownSets: Record<string, KnownSetEntry[]>; roles: string[] } {
    const ks: Record<string, KnownSetEntry[]> = {};
    for (const [k, v] of this.knownSets) ks[k] = v;
    return {
      events: this.events,
      sideBranches: this.sideBranches,
      facts: this.facts,
      knownSets: ks,
      seqCounter: this.seqCounter,
      roles: this.roles,
    };
  }

  /** 从存档恢复 */
  static restore(data: ReturnType<LedgerStore["export"]>): LedgerStore {
    const store = new LedgerStore();
    store.events = data.events;
    store.sideBranches = data.sideBranches;
    store.facts = data.facts;
    store.seqCounter = data.seqCounter;
    store.roleSet = new Set(data.roles);
    for (const role of data.roles) store.knownSets.set(role, []);
    // 重放 KnownSet
    for (const ev of data.events) store._updateKnownSets(ev, true);
    for (const ev of data.sideBranches) store._updateKnownSets(ev, true);
    for (const f of data.facts) store._updateFactKnownSets(f, true);
    return store;
  }

  // ---- 内部：KnownSet 增量刷（005 Q3 增量 O(1)，不做全量重算兜底） ----

  private _visibleTo(role: string, radius: string[] | "all"): boolean {
    if (radius === "all") return true;
    return radius.includes(role);
  }

  private _blurLevel(ev: LedgerEvent): "none" | "high" | "max" {
    // 005 Q4 三档表：MVP 只 none + max
    if (ev.canon_status === "canon") return "none";
    if (ev.canon_status === "provisional") return "high";
    return "max"; // rumor
  }

  private _updateKnownSets(ev: LedgerEvent, replay = false): void {
    const blur = this._blurLevel(ev);
    const radius = ev.propagation_radius;
    for (const role of this.roleSet) {
      if (!this._visibleTo(role, radius)) continue;
      const entry: KnownSetEntry = {
        ref: `ev_${ev.seq}`,
        blur_level: blur,
        description: `[${ev.kind}] ${ev.fact_ref} = ${JSON.stringify(ev.value)} (seq ${ev.seq})`,
      };
      this.knownSets.get(role)!.push(entry);
    }
  }

  private _updateFactKnownSets(f: FactEntry, replay = false): void {
    for (const role of this.roleSet) {
      if (!this._visibleTo(role, f.who_can_see)) continue;
      const blur: "none" | "high" | "max" =
        f.canon_status === "canon" ? "none" : f.canon_status === "provisional" ? "high" : "max";
      const entry: KnownSetEntry = {
        ref: f.fact_id,
        blur_level: blur,
        description: `[fact] ${f.subject} = ${JSON.stringify(f.value)}`,
      };
      this.knownSets.get(role)!.push(entry);
    }
  }

  private _injectRumor(role: string, ev: SideBranchEvent): void {
    const blur = ev.rumor_injection?.blur_level ?? "max";
    const entry: KnownSetEntry = {
      ref: `rumor_${ev.seq}`,
      blur_level: blur,
      description: ev.rumor_injection
        ? `[传闻] ${ev.fact_ref}: ${ev.rumor_injection.target} 视角 — ${ev.rumor_injection.perspective} (blur=${blur})`
        : `[传闻] ${ev.fact_ref} (seq ${ev.seq}, blur=${blur})`,
    };
    this.knownSets.get(role)?.push(entry);
  }
}
