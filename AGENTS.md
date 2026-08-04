# AI Agent Instructions

This file is the single source of truth for AI coding assistants working on **obsidian-dragger**.

Keep this file limited to durable, cross-session guidance. Current progress and temporary scratch do not belong here.

## Project

- Purpose: Obsidian plugin host for markdown block drag-and-drop
- Core engine: `md-dragger` (`file:../md-dragger`) — **all engine logic lives there**
- Stack: TypeScript, CodeMirror 6, Obsidian plugin API, esbuild
- Package manager: pnpm

## Responsibilities & layering

This repo is the **host**: it renders engine state and integrates the Obsidian editor. It does not implement drag logic.

| Layer | Path | Owns |
|---|---|---|
| platform | `src/platform/codemirror` | CodeMirror/Obsidian host integration: render selection highlight, handle checkboxes, drop indicator, dragging body class; wire `mdDragger(options)` with host-specific geometry. |
| platform | `src/platform/obsidian` | Obsidian API adapters (app, editor view, workspace). |
| plugin | `src/plugin` | Plugin shell: settings, commands, i18n, block-type menu, main entry. |
| shared | `src/shared` | Constants and DOM selectors shared by host code. |

Reuse rules (the engine owns complexity — do not reimplement it):

- Block detection, selection math, drop-position planning, move transactions, and the drag state machine come from `md-dragger` (`md-dragger/domain`, `md-dragger/runtime`, `md-dragger/adapter/codemirror`).
- Rendering consumes engine results: `selectionLineRanges` / `isLineNumberInRanges` for highlight + checkboxes, `dropSeam` / `lineBand` for geometry, pipeline outputs for state.
- Before writing any non-trivial logic, check the engine's public surface (`md-dragger/src/domain/index.ts`) for an existing function. Reuse it; only host-specific rendering stays here.
- Never re-derive selection sets, block ranges, or drop positions from raw lines — that is domain work.

## Commands

- Install: `pnpm install`
- Dev: `pnpm run dev`
- Build (plugin): `pnpm run build`
- Build (core, sibling repo): `pnpm run build` in `../md-dragger`
- Typecheck: `pnpm run typecheck`
- Test: `pnpm test`
- Lint: `pnpm run lint` (ESLint); formatting: `pnpm run format` / `format:check` (Biome)

## Communication

- Use Simplified Chinese for user-facing explanations, questions, progress updates, and summaries.
- Keep code, identifiers, comments, logs, test names, and commit messages in English.

## Always Build After Changes

**After any code change that affects runtime behavior, always build before finishing the turn.** Do not wait for the user to ask.

Build order:

1. If `md-dragger` (`../md-dragger`) was changed:  
   `cd ../md-dragger && pnpm run build`
2. Always build this plugin so Obsidian loads the fresh bundle:  
   `cd <obsidian-dragger> && pnpm run build`

Notes:

- This repo depends on `md-dragger` via `file:../md-dragger`. Core changes are not visible to the plugin until the core package is built (and `pnpm install` re-copies the `file:` dependency into the store).
- Plugin build copies artifacts the vault/plugin loader uses; skipping it leaves Obsidian on a stale build.
- If only docs/AGENTS were edited and no runtime code changed, build is optional.
- If a relevant build cannot run, state that explicitly in the completion summary.

## Working Agreement

- Stay within the stated scope. Do not add, refactor, or improve unrelated functionality.
- Prefer fixing logic in `md-dragger` when the bug is engine/locate/geometry/runtime; keep this repo as Obsidian host (paint, settings, shell).
- Reuse engine interfaces instead of reimplementing logic here (see "Responsibilities & layering" above).
- Do not add dependencies unless the user approves them.
- Create commits only when the user asks.

## Engineering Principles

- No fallbacks or downgrades: a value comes from its single source of truth, or the code fails explicitly with a clear error. Never silently substitute a default, a previous value, or a guessed value when the real one is unavailable, and never keep stale state because a fresh value could not be produced.
- No wrappers: a function that only forwards to another function (same signature, one caller) is deleted; call sites call the target directly.
- No over-engineering: no speculative abstractions, no single-implementation interfaces, no config nobody sets, no layers with one caller. Delete dead code; make the smallest precise change.

## Verification

- Run the relevant checks after changes (`build` is mandatory per above; add `typecheck` / `test` when the change warrants it).
- Fix failures caused by the current change, then rerun.
- Review the final diff and keep it task-related only.

## Done

- Required builds completed (or unrun builds explained).
- Summary states what changed, builds run, and remaining risks.
