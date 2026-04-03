# CalcTrainer

CalcTrainer is a local Electron app for mandatory 10-20 minute deep-learning calculus practice on macOS.

It is seeded from the provided course material:
- `Data 255 Math/Lecture 4.pdf`
- `Data 255 Math/Lecture 5.pdf`
- `Data 255 Math/Lecture 6.pdf`
- `Data 255 Math/assignment5.pdf`
- `Data 255 Math/DATA255_12_assignment5.pdf`

## What it does
- Queues practice sessions every 2 hours at `09:00`, `11:00`, `13:00`, `15:00`, `17:00`, and `19:00`
- Keeps overdue sessions active until you finish the question set and the 10-minute minimum timer
- Supports a dynamic question-bank workflow: import PDF/PPTX documents, generate draft questions through an OpenAI-compatible proxy, review/edit/delete drafts, and publish approved questions into the live bank
- Uses three exercise modes:
  - auto-graded multiple choice
  - auto-graded numeric and structured answers
  - worked-solution reveal plus self-check for full derivations
- Tracks weak topics, streaks, and recent history locally on your machine

## Run it
```bash
npm install
npm start
```

Useful commands:
```bash
npm run build
npm run typecheck
npm test
npm run test:smoke
npm run package:dir
npm run package:mac
```

Packaging output:
- `release/mac-arm64/CalcTrainer.app`
- `release/CalcTrainer-1.0.0-arm64.zip`
- `release/CalcTrainer-1.0.0-arm64.dmg`

## Notes
- The app stores its local state in Electron's user-data directory as `calc-trainer-state.json`.
- The generated question bank is stored separately in Electron's user-data directory as `calc-trainer-question-bank.json`, alongside managed document copies and extracted-text JSON files.
- On launch, the app enables `openAtLogin` so it can keep scheduling reminders in the background.
- `npm run package:mac` produces an ad-hoc signed local build. It is suitable for local use, but it is not notarized for distribution.

## Question Bank Proxy
- Set `CALCTRAINER_AI_PROXY_BASE_URL` to the base URL for your generation backend.
- Set `CALCTRAINER_AI_PROXY_MODEL` when the backend supports an OpenAI-style `POST /responses` endpoint.
- Optionally set `CALCTRAINER_AI_PROXY_TOOL` to the CLI tool name for `AI-CLI-proxy-server`; if omitted, CalcTrainer will use the proxy's default tool or fall back to `codex`.
- Optionally set `CALCTRAINER_AI_PROXY_PARSE_MODE` to `auto`, `raw_files`, or `chunked`. The default is `auto`, which prefers raw-file parsing through `POST /api/low-level` and falls back to chunked generation when raw-file mode is unavailable.
- Optionally set `CALCTRAINER_AI_PROXY_AUTH_TOKEN` or `CALCTRAINER_AI_PROXY_API_KEY` if the proxy expects bearer auth.
- In `auto` mode, CalcTrainer prefers raw-file parsing through `POST /api/low-level` with managed document paths in `files`, falls back to `POST /responses` when raw-file mode is unavailable, and uses chunked low-level generation as a final fallback when only the CLI transport is available.
- The dashboard question-source card lets you choose `seeded`, `generated`, or `mixed` selection for future sessions.

## Test overrides
- Set `CALCTRAINER_USER_DATA_DIR=/absolute/path` to redirect the app state directory for isolated QA runs.
- Set `CALCTRAINER_DISABLE_LOGIN_ITEM=1` to skip `openAtLogin` registration during automated or temporary test launches.

## Electron smoke test
- Run `npm run test:smoke` from a normal logged-in macOS desktop session.
- The smoke harness builds the app, seeds an overdue session in an isolated temp profile, launches Electron, switches enforcement to lighter mode, hides and reopens the practice window, completes one full session, verifies the next pending session activates, and confirms the updated state survives a relaunch.
- Artifacts are written to `output/playwright/smoke-*/`, including screenshots and `summary.json` or `failure.json`.
- Set `CALCTRAINER_SMOKE_OUTPUT_DIR=/absolute/path` to override the artifact directory.
- Set `CALCTRAINER_SMOKE_KEEP_PROFILE=1` to preserve the isolated temp profile after a passing run.
- The harness strips `ELECTRON_RUN_AS_NODE` from the child Electron process automatically, but GUI-less shells can still fail before AppKit registration.
