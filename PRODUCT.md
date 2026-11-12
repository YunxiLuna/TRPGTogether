# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: plain Node.js (no framework) + static HTML/CSS/JS single-page app. No build step for frontend; Node serves web/index.html directly. Backend: TypeScript compiled with tsc, no framework (raw http server).

## Users

- **Player (角色 A/B)**: In a shared fiction, 2–6 people co-author a world. Each player controls one character. They see a chat-style interface: the shared story stream + LLM-generated 3 quick-advance options + free text input. They also see their own character panel (public/private/rumor layers) without spending tokens asking the LLM.
- **GM**: The game master. Sees the full dashboard: all players' 3-layer panels, event ledger + narrative proposals, settle form, absence briefing, LLM provider config. Monitors numeric values and story direction across all players.

## Product Purpose

共典 (Co-Canon) is a shared-worldview TRPG engine: multiple players and one GM co-author a persistent world. The core mechanism is **append-only ledger + 3-layer information asymmetry** (public / private / rumor) + **LLM as narrative proposer only** (the engine is the sole settlement writer). Success = a 2–6 person session runs a coherent shared world where each player sees only what their character should know, and the LLM advances the story without corrupting the ledger.

## Positioning

- LLM **proposes**, engine **settles** — narrative LLM can never write canon values (002 resolution ②)
- **Information asymmetry by construction**: 3-layer KnownSet per role, rumor injection with blur levels, absence briefing
- **6-base schema grammar** (quantity / formula / state_machine / mapping / side_branch / rumor_injection) — no ad-hoc code
- **Single LLM gateway** on server (009 Q3) — one provider, all narrative calls share its cache

## Operating Context

- Local dev: Node server on 127.0.0.1:54272, players open /player/A, /player/B, /gm in browser
- LLM provider configurable via .env file (gitignored) or web UI panel (hot-swap, no restart)
- Schema YAML loaded from test/fixtures/ (MVP) or user-provided path
- World books: 修仙大千 (MVP validation), 斗罗 (R1 risk validation, S2 trigger rate 53.3%)

## Capabilities and Constraints

- 16/16 tests passing; pnpm test = node --import tsx --test test/*.test.ts
- Schema: 5 quantities, 3 formulas, 1 state machine (16 states), expression grammar: + - * / ( ) constants only
- LLM: mock (zero-network) default; openai-compatible with any BASE_URL (Ollama/DeepSeek/OpenAI)
- R1 risk: complex worldbooks (斗罗 53.3% S2 trigger) need S2 escape hatch; MVP validation uses 修仙大千 (008 Q8)
- 009 Q1: single-room model (no LAN multiplayer); 009 Q10: browser minimal UI delivered
- No database: in-memory LedgerStore + YAML schema file; persistence = ledger export/import (009 Q2)

## Brand Commitments

- Name: 共典 (Co-Canon)
- Aesthetic direction: user requested "重新设计" (redesign) of the current dark UI; no pinned palette or typeface
- UI language: Chinese (all labels, buttons, section headers)
- The product is a **toy/prototype** for 2–6 person shared fiction, not a commercial SaaS

## Evidence on Hand

- 9 spec docs in docs/spec/共典/ (001–009, schema-示例)
- 14 handoff docs in .scratch/handoff/
- Working MVP: ledger, schema, interpreter, knownset, briefing, LLM gateway, smoke test
- web/index.html: current single-page app (dark theme, gold accent #d4a853, chat + dashboard)
- Test fixtures: xiuxian-breakthrough.yaml (修仙), doulou-s2-catalog.yaml (斗罗 R1)

## Product Principles

1. **Engine authority**: LLM proposes, engine settles — the ledger is the single source of truth
2. **Information asymmetry is the product**: 3-layer KnownSet, rumor blur, absence briefing
3. **Small grammar, no ad-hoc code**: 6-base schema, expression language without if/lookup/iteration
4. **Token frugality**: panels visible without LLM calls; LLM only for narrative + prompts
5. **Local-first, zero-infra**: no database, no cloud, no auth — Node + browser, .env for LLM key

## Accessibility & Inclusion

No specific accessibility requirements established yet. UI is Chinese-first. Dark theme is a committed design choice (game/fiction context, low-light reading).
