# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm start              # build + launch Electron
npm run build          # tsc main + tsc renderer + copy-static
npm run typecheck      # both tsconfigs, no emit
npm test               # vitest run (all tests)
npm test -- tests/grading.test.ts        # single file
npm test -- -t "name pattern"            # filter by test name
npm run test:smoke     # full Electron smoke test (needs GUI session)
npm run package:dir    # unpacked .app
npm run package:mac    # ad-hoc signed dmg + zip (not notarized)
```

The build pipeline compiles `src/main.ts` → `dist/main/`, `src/renderer/renderer.ts` → `dist/renderer/`, then `scripts/copy-static.mjs` copies `index.html` and `styles.css`. `package.json#main` points at `dist/main/main.js`, so `electron .` will not work without a build.

## Architecture

CalcTrainer is a single-window-pair Electron app (commonjs). Two tsconfigs build two separate worlds that share `src/shared/`:

- **Main process** (`src/main.ts`) — owns app state, schedules reminders, opens/closes the practice window, and exposes IPC handlers. State lives in two JSON files in Electron's userData dir: `calc-trainer-state.json` (sessions/progress) and `calc-trainer-question-bank.json` (imported docs + draft/published questions). Override the userData dir with `CALCTRAINER_USER_DATA_DIR` for isolated runs; `CALCTRAINER_DISABLE_LOGIN_ITEM=1` skips `openAtLogin`.
- **Preload** (`src/preload.ts`) — narrow contextBridge surface; the renderer talks to main only through it.
- **Renderer** (`src/renderer/renderer.ts`, ~1900 lines) — both the dashboard and the practice window load the same `index.html`/bundle and branch on the snapshot they receive.
- **Shared** (`src/shared/`) — pure modules with no Electron imports, so they're unit-testable under vitest/jsdom:
  - `schedule.ts` — queues sessions at fixed hours (09, 11, 13, 15, 17, 19) and keeps overdue ones active.
  - `practice.ts` — session lifecycle: activate → submit answers → reveal worked solutions → self-check → complete. Enforces minimum-time and full-completion gates.
  - `questions.ts` — seeded question bank + selection logic across `derivation | backprop_auto | cnn_auto | concept` buckets honoring `questionSourceMode` (`seeded | generated | mixed`).
  - `question-bank-storage.ts` (~2700 lines) — the dynamic question-bank workflow: import PDF/PPTX, call an OpenAI-compatible proxy (`POST /responses` or `POST /api/low-level`), parse drafts, store them, and publish into the live bank. Behavior is driven by `CALCTRAINER_AI_PROXY_*` env vars (see README).
  - `selectors.ts` — builds the `AppSnapshot` the renderer consumes; emits a `slim` payload to the dashboard and a `full` payload to the practice window.
  - `storage.ts` / `settings.ts` / `time.ts` / `types.ts` — file IO, settings sanitization, timezone math, and the type surface (`AppState`, `AppSnapshot`, `QuestionBankState`, etc.). `types.ts` is the source of truth for shared shapes.

The two windows are distinguished in main by `webContents.id` (see `isPracticeWindowWebContents` / `snapshotStyleForWebContents`) — that's how the renderer gets different snapshot detail levels from the same IPC channel.

## Tests

Vitest with jsdom. `tests/e2e-flow.test.ts` and `tests/renderer-*.test.ts` drive the renderer module directly against a jsdom-mounted `index.html`; the rest hit shared modules in isolation. `tests/storage-and-coverage.test.ts` covers the JSON file IO. The Electron smoke test (`scripts/electron-smoke.mjs` via Playwright) is separate from `npm test` — it requires a real logged-in macOS desktop and writes artifacts to `output/playwright/smoke-*/` (override with `CALCTRAINER_SMOKE_OUTPUT_DIR`, keep profile with `CALCTRAINER_SMOKE_KEEP_PROFILE=1`).

## Question-bank proxy

Generation goes through an external OpenAI-compatible proxy. Configure with `CALCTRAINER_AI_PROXY_BASE_URL`, `CALCTRAINER_AI_PROXY_MODEL`, `CALCTRAINER_AI_PROXY_TOOL`, `CALCTRAINER_AI_PROXY_PARSE_MODE` (`auto | raw_files | chunked`), and `CALCTRAINER_AI_PROXY_AUTH_TOKEN`/`CALCTRAINER_AI_PROXY_API_KEY`. In `auto` mode the bank prefers `POST /api/low-level` raw-file parsing, falls back to `POST /responses`, then to chunked low-level CLI generation.
