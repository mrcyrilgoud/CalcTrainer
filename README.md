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
- On launch, the app enables `openAtLogin` so it can keep scheduling reminders in the background.
- `npm run package:mac` produces an ad-hoc signed local build. It is suitable for local use, but it is not notarized for distribution.

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
