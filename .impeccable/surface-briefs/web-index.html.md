# Surface: web/index.html

## Mode
Operate

## Direction Contract

THESIS: A shared-fiction cockpit where the ledger's three-layer information asymmetry is the visual centerpiece — not a dark dashboard with one gold accent, but a **warm parchment-and-ink world** that feels like reading a story, not operating a console. The category default (near-black + neon) is refused.

OWN-WORLD:
- Ground: warm cream paper #faf6ef, not grey or black
- Ink: deep sepia #2a2420 for body text (≥7:1 contrast on cream)
- Accent: burnt sienna #c45d3a for primary actions and state highlights
- Public layer: clean ink on cream; Private layer: subtle blue-grey tint #e8edf2; Rumor layer: warm amber wash #f5e6d0 with dashed left border
- LLM narrative: italic serif voice (Georgia), slightly larger, with a soft drop shadow
- Player chat: cream bubbles on left (narrative), sienna-tinted bubbles on right (player)
- Event cards: thin 1px border, no shadow, dense 12px type
- Signature move: **layer-tinted cards** — each panel section's background shifts subtly by information layer (public=cream, private=cool tint, rumor=warm amber), so information asymmetry is visible at a glance without color-blindness issues (dashed border on rumor reinforces)

STORY:
- Player sees: chat stream (story + events), 3 LLM quick-advance chips, own 3-layer panel on the side — all at a glance, no token spend
- GM sees: all players' panels side-by-side, full ledger + narrative feed, settle/narrative/briefing forms, LLM config
- Both: LLM provider hot-swap without restart

FIRST VIEWPORT:
- Top bar: product name 共典 + meta (seq/schema/LLM) + role nav
- Player: left 60% chat stream + composer; right 40% own panel (3 layers, compact)
- GM: top full-width ledger + narrative; below, grid of player panels (each showing 3 layers); below, forms row

FORM:
- Surface scope: layout composition of the two views (player chat + GM dashboard)
- Seed: fb04d819c0da13628148630c5dfb7074

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
