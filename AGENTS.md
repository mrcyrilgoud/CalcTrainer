# CalcTrainer

A local Electron desktop app for mandatory calculus practice sessions. See `README.md` for full docs.

## Cursor Cloud specific instructions

### Running the app

The app is an Electron application. In the cloud VM (headless Linux), you must pass `--no-sandbox` to Electron. Use the test-override env vars to avoid system side effects:

```bash
npm run build
DISPLAY=:1 CALCTRAINER_DISABLE_LOGIN_ITEM=1 CALCTRAINER_USER_DATA_DIR=/tmp/calctrainer-test npx electron . --no-sandbox
```

- `CALCTRAINER_DISABLE_LOGIN_ITEM=1` prevents the app from registering itself as a login item (which would fail on Linux).
- `CALCTRAINER_USER_DATA_DIR=/tmp/calctrainer-test` isolates state from any other run.
- The app opens a dashboard window on launch. Practice sessions activate on a 2-hour schedule (see `src/shared/schedule.ts`), so to test a practice session you may need to inject state into the JSON state file or modify the schedule logic temporarily.

### Standard commands

All defined in `package.json` scripts:

- **Build:** `npm run build`
- **Typecheck:** `npm run typecheck`
- **Test:** `npm test` (Vitest, 6 test files, runs in ~1s)
- **Dev/Start:** `npm start` (builds then launches Electron)

### Notes

- D-Bus errors in the terminal output (e.g. `Failed to connect to the bus`) are expected in headless Linux and do not affect app functionality.
- The app exits immediately if `window-all-closed` fires on non-darwin. In the cloud VM (Linux), closing the last window quits the process.
- No external services, databases, or APIs are required. All state is a local JSON file.
