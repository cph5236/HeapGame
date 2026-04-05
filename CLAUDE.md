# CLAUDE.md — HeapGame

## Project Overview

Heap is a mobile-first 2D vertical climbing platformer (Phaser 3 + TypeScript + Vite 6 + Capacitor). Players control a trash item climbing a community-grown heap. The backend is a Cloudflare Worker (Hono + D1) with GUID-based CRUD routes at `/heaps`. Tests run via Vitest.

Stack: `phaser@3.90`, `typescript@5.9.3`, `vite@6.x`, `@capacitor/core@8.2`, `hono`, `@cloudflare/workers-types`, `vitest`.

---

## TheBrain Plugin — Session Lifecycle

TheBrain is the memory and context system for this project. Use it every session.

### Commands

| Command | When to use |
|---|---|
| `/hello` | **Start of every session** — restores recent session context and working memory |
| `/continue` | After context compaction mid-session, or resuming a paused project |
| `/wrapup` | **End of every session** — saves context, hot files, and next steps for recall |
| `/dopamine +` | Something went well — reinforce the pattern so it repeats |
| `/dopamine -` | Something went wrong — flag it so it doesn't repeat |
| `/oxytocin` | A collaboration dynamic worth capturing (tone, pacing, decision style) |

### Rules

- Always run `/hello` before starting work. It loads recent sessions and working memory.
- Always run `/wrapup` before closing. Skipping it means the next session starts cold.
- Use `/dopamine` and `/oxytocin` freely — they make the brain smarter over time.
- If asked to recall something from a previous session, check TheBrain before searching files.
- Working memory (`dlpfc-live.md`) tracks hot files with heat scores — load it when it exists.

---

## Context7 — Documentation Lookup

Use the `mcp__plugin_context7_context7__resolve-library-id` and `mcp__plugin_context7_context7__query-docs` tools whenever working with a documented library or framework. Do not rely on training data alone — API surfaces change.

### When to use Context7

- Writing or debugging **Phaser 3** scene, physics, input, camera, or asset code
- Working with **Hono** route handlers, middleware, or context objects
- Working with **Cloudflare Workers** bindings, D1, or environment types
- Using **Capacitor** plugins, native bridge APIs, or build config
- Using **Vitest** test APIs, matchers, or config options
- Using **Vite** config, plugins, or build pipeline options

### When NOT to use Context7

- Pure TypeScript/JavaScript logic with no framework dependency
- Refactoring existing code that already works
- Business logic or game design decisions

---

## Superpowers Plugin — Skills

Superpowers skills override default behavior. Check for a relevant skill **before** any non-trivial action — even clarifying questions come after skill invocation if a skill applies.

### Mandatory skill triggers

| Situation | Skill to invoke |
|---|---|
| Starting any new feature, component, or system | `superpowers:brainstorming` |
| Received a spec or requirements list for multi-step work | `superpowers:writing-plans` |
| Executing a written implementation plan | `superpowers:executing-plans` |
| Implementing any feature or bugfix (before writing code) | `superpowers:test-driven-development` |
| Hit a bug, test failure, or unexpected behavior | `superpowers:systematic-debugging` |
| Finishing implementation — about to claim it's done | `superpowers:verification-before-completion` |
| Work is complete, tests pass, ready to integrate | `superpowers:finishing-a-development-branch` |
| Received code review feedback | `superpowers:receiving-code-review` |
| 2+ independent tasks that can run in parallel | `superpowers:dispatching-parallel-agents` |

### Key rules

- **Brainstorm before building.** Any "let's add X" prompt requires brainstorming first.
- **TDD before implementation.** Write failing tests, then make them pass.
- **Verify before claiming done.** Run the actual commands; don't assert success without evidence.
- **Write plans for multi-step tasks.** Plans live in `docs/superpowers/plans/`.
- **Rigid skills are rigid.** TDD and debugging skills are not optional when triggered — follow them exactly.

---

## Project Conventions

- Feature work happens on branches off `main`; current active branch is `feature/HeapServer`
- Server code lives in `server/`; game client in `src/`; shared types in `shared/`
- Tests live alongside server code in `server/tests/`
- `npm run dev` starts Vite on port 3000; `npm run test` runs Vitest
- Local D1 is managed by Wrangler; seed with `npx ts-node scripts/seed-heap.ts`
- Do not commit `.wrangler/state/` — it contains local DB state
