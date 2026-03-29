import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { _electron as electron } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoDir = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const electronBinary = require('electron');
const { createDefaultState, saveStateFile, loadStateFile } = require('../dist/main/shared/storage.js');
const { queueDueSessions } = require('../dist/main/shared/schedule.js');

const nowStamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = process.env.CALCTRAINER_SMOKE_OUTPUT_DIR?.trim()
  ? path.resolve(process.env.CALCTRAINER_SMOKE_OUTPUT_DIR)
  : path.join(repoDir, 'output', 'playwright', `smoke-${nowStamp}`);
const keepProfile = process.env.CALCTRAINER_SMOKE_KEEP_PROFILE === '1';

const diagnostics = {
  console: [],
  pageErrors: []
};
let failureWritten = false;
const failureContext = {
  outputDir,
  profileDir: null,
  stateFile: null
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureBuildArtifacts() {
  const mainEntry = path.join(repoDir, 'dist', 'main', 'main.js');
  const rendererEntry = path.join(repoDir, 'dist', 'renderer', 'index.html');

  if (!fs.existsSync(mainEntry) || !fs.existsSync(rendererEntry)) {
    throw new Error('Build artifacts are missing. Run `npm run build` before `npm run test:smoke`.');
  }
}

function buildSeedState() {
  const seededAt = new Date('2026-03-28T13:05:00-07:00');
  const baseline = createDefaultState(new Date('2026-03-28T08:30:00-07:00'));
  return queueDueSessions(baseline, seededAt).state;
}

function makeChildEnv(profileDir) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE')),
    CALCTRAINER_USER_DATA_DIR: profileDir,
    CALCTRAINER_DISABLE_LOGIN_ITEM: '1'
  };
}

function labelForPage(page) {
  const url = page.url();
  if (url.includes('mode=practice')) {
    return 'practice';
  }
  if (url.includes('mode=dashboard')) {
    return 'dashboard';
  }
  return 'window';
}

function attachDiagnostics(page) {
  page.on('console', (msg) => {
    diagnostics.console.push({
      page: labelForPage(page),
      type: msg.type(),
      text: msg.text()
    });
  });
  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push({
      page: labelForPage(page),
      message: String(error)
    });
  });
}

async function collectWindows(electronApp) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const windows = electronApp.windows();
    const dashboard = windows.find((page) => page.url().includes('mode=dashboard'));
    const practice = windows.find((page) => page.url().includes('mode=practice'));
    if (dashboard && practice) {
      return { dashboard, practice };
    }
    await wait(250);
  }

  throw new Error('Timed out waiting for both dashboard and practice windows.');
}

async function browserWindowStates(electronApp) {
  return electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      title: window.getTitle(),
      visible: window.isVisible(),
      destroyed: window.isDestroyed()
    }))
  );
}

async function answerQuestion(practice, question) {
  const card = practice.locator(`[data-question-card="${question.id}"]`);
  await card.waitFor({ state: 'visible' });

  switch (question.answerSchema.kind) {
    case 'multiple_choice':
      await card.locator(`input[type="radio"][value="${question.answerSchema.correctIndex}"]`).check();
      await card.getByRole('button', { name: 'Check answer' }).click();
      break;
    case 'numeric':
      await card.locator('input.text-input').fill(String(question.answerSchema.correctValue));
      await card.getByRole('button', { name: 'Check answer' }).click();
      break;
    case 'structured':
      await card.locator('input.text-input').fill(String(question.answerSchema.acceptableAnswers[0] ?? ''));
      await card.getByRole('button', { name: 'Check answer' }).click();
      break;
    case 'derivation':
      await card.getByRole('button', { name: 'Reveal worked solution' }).click();
      await card.getByRole('button', { name: 'Solid' }).click();
      break;
    default:
      throw new Error(`Unhandled question kind: ${question.answerSchema.kind}`);
  }

  await practice.waitForFunction(
    ({ questionId }) => {
      const cardEl = document.querySelector(`[data-question-card="${questionId}"]`);
      if (!cardEl) {
        return false;
      }

      return Array.from(cardEl.querySelectorAll('.badge.success')).some((el) =>
        (el.textContent || '').includes('Complete')
      );
    },
    { questionId: question.id },
    { timeout: 5_000 }
  );
}

async function launchApp(profileDir) {
  const electronApp = await electron.launch({
    executablePath: electronBinary,
    args: [repoDir],
    cwd: repoDir,
    env: makeChildEnv(profileDir)
  });

  const knownPages = new Set();
  for (const page of electronApp.windows()) {
    knownPages.add(page);
    attachDiagnostics(page);
  }

  const watcher = setInterval(() => {
    for (const page of electronApp.windows()) {
      if (knownPages.has(page)) {
        continue;
      }

      knownPages.add(page);
      attachDiagnostics(page);
    }
  }, 100);

  return { electronApp, watcher };
}

function writeJson(fileName, payload) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, fileName), JSON.stringify(payload, null, 2));
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      cause: error.cause instanceof Error
        ? {
            message: error.cause.message,
            stack: error.cause.stack
          }
        : error.cause
    };
  }

  return { message: String(error) };
}

function writeFailurePayload(error) {
  if (failureWritten) {
    return;
  }

  failureWritten = true;
  const serializedError = serializeError(error);
  const guidance = serializedError.message.includes('Process failed to launch!')
    ? [
        'Electron did not reach the first window.',
        'Run `npm run test:smoke` from a normal logged-in macOS desktop session.',
        'If the host shell injects `ELECTRON_RUN_AS_NODE`, the harness removes it for the child app automatically.'
      ].join(' ')
    : null;

  writeJson('failure.json', {
    status: 'failed',
    outputDir: failureContext.outputDir,
    profileDir: failureContext.profileDir,
    stateFile: failureContext.stateFile,
    diagnostics,
    error: serializedError,
    guidance
  });
}

function buildLaunchFailureMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    message,
    'Electron failed before the smoke flow could start.',
    'Run this from a normal logged-in macOS desktop session, not a GUI-less shell.',
    'The harness already removes `ELECTRON_RUN_AS_NODE` from the child app environment.'
  ].join(' ');
}

async function main() {
  ensureBuildArtifacts();
  fs.mkdirSync(outputDir, { recursive: true });

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calctrainer-smoke-'));
  const stateFile = path.join(profileDir, 'calc-trainer-state.json');
  failureContext.profileDir = profileDir;
  failureContext.stateFile = stateFile;
  const seededState = buildSeedState();
  const expectedNextSessionId = seededState.sessions
    .filter((session) => session.status === 'pending')
    .sort((left, right) => new Date(left.scheduledFor).getTime() - new Date(right.scheduledFor).getTime())[0]?.id;

  if (!expectedNextSessionId) {
    throw new Error('Smoke seed state did not produce a next pending session.');
  }

  saveStateFile(stateFile, seededState);

  let electronApp = null;
  let watcher = null;

  try {
    try {
      ({ electronApp, watcher } = await launchApp(profileDir));
    } catch (error) {
      const wrapped = new Error(buildLaunchFailureMessage(error), { cause: error });
      throw wrapped;
    }

    const { dashboard, practice } = await collectWindows(electronApp);
    await dashboard.waitForSelector('[data-view="dashboard"]');
    await practice.waitForSelector('[data-view="practice"]');

    const dashboardInitialPng = path.join(outputDir, 'dashboard-initial.png');
    const practiceInitialPng = path.join(outputDir, 'practice-initial.png');
    const practiceAfterCompletionPng = path.join(outputDir, 'practice-after-completion.png');
    const dashboardAfterCompletionPng = path.join(outputDir, 'dashboard-after-completion.png');

    await dashboard.screenshot({ path: dashboardInitialPng });
    await practice.screenshot({ path: practiceInitialPng });

    const dashboardSnapshot = await dashboard.evaluate(() => window.calcTrainer.getSnapshot());
    assert.ok(dashboardSnapshot.activeSession, 'Expected an active session on launch.');
    assert.equal(dashboardSnapshot.pendingCount, 3, 'Expected three seeded sessions on launch.');

    await dashboard.getByRole('button', { name: 'Lighter' }).click();
    await dashboard.locator('[data-setting-field="lighter-reopen-delay"]').fill('3');
    await dashboard.getByRole('button', { name: 'Save delay' }).click();

    const updatedDashboardSnapshot = await dashboard.evaluate(() => window.calcTrainer.getSnapshot());
    assert.equal(updatedDashboardSnapshot.settings.enforcementStyle, 'lighter');
    assert.equal(updatedDashboardSnapshot.settings.lighterReopenDelayMinutes, 3);

    await practice.evaluate(() => window.close());
    await wait(500);

    const hiddenWindowStates = await browserWindowStates(electronApp);
    const hiddenPractice = hiddenWindowStates.find((entry) => entry.title === 'CalcTrainer Practice');
    assert.ok(hiddenPractice, 'Practice window should still exist after close interception.');
    assert.equal(hiddenPractice.visible, false, 'Practice window should hide instead of closing.');

    await dashboard.getByRole('button', { name: 'Open active session' }).click();
    await wait(500);

    const reopenedStates = await browserWindowStates(electronApp);
    const reopenedPractice = reopenedStates.find((entry) => entry.title === 'CalcTrainer Practice');
    assert.ok(reopenedPractice?.visible, 'Practice window should become visible again.');

    const practiceSnapshot = await practice.evaluate(() => window.calcTrainer.getSnapshot());
    assert.equal(practiceSnapshot.activeSession.id, seededState.activeSessionId);
    assert.ok(practiceSnapshot.activeSession.questions.length > 0, 'Expected seeded practice questions.');

    for (const question of practiceSnapshot.activeSession.questions) {
      await answerQuestion(practice, question);
    }

    await practice.waitForFunction(() => {
      const gate = document.querySelector('[data-live="completion-gate"]');
      const button = document.querySelector('[data-action="complete-session"]');
      return gate?.textContent?.includes('Unlocked') && button instanceof HTMLButtonElement && !button.disabled;
    });

    await practice.getByRole('button', { name: 'Complete session' }).click();
    await practice.waitForFunction(
      ({ expectedId }) => document.querySelector('[data-view="practice"]')?.getAttribute('data-session-id') === expectedId,
      { expectedId: expectedNextSessionId },
      { timeout: 5_000 }
    );

    const postCompletionPracticeSnapshot = await practice.evaluate(() => window.calcTrainer.getSnapshot());
    const postCompletionDashboardSnapshot = await dashboard.evaluate(() => window.calcTrainer.getSnapshot());

    assert.equal(postCompletionPracticeSnapshot.activeSession.id, expectedNextSessionId);
    assert.equal(postCompletionDashboardSnapshot.pendingCount, 2);
    assert.equal(postCompletionDashboardSnapshot.completedToday, 1);

    await practice.screenshot({ path: practiceAfterCompletionPng });
    await dashboard.screenshot({ path: dashboardAfterCompletionPng });

    await electronApp.close();
    clearInterval(watcher);
    electronApp = null;
    watcher = null;

    const persistedState = loadStateFile(stateFile);
    const completedSeededSession = persistedState.sessions.find((session) => session.id === seededState.activeSessionId);
    assert.equal(completedSeededSession?.status, 'completed');
    assert.equal(persistedState.activeSessionId, expectedNextSessionId);
    assert.equal(persistedState.settings.enforcementStyle, 'lighter');
    assert.equal(persistedState.settings.lighterReopenDelayMinutes, 3);

    ({ electronApp, watcher } = await launchApp(profileDir));

    const { dashboard: relaunchedDashboard, practice: relaunchedPractice } = await collectWindows(electronApp);
    await relaunchedDashboard.waitForSelector('[data-view="dashboard"]');
    await relaunchedPractice.waitForSelector('[data-view="practice"]');

    const relaunchDashboardSnapshot = await relaunchedDashboard.evaluate(() => window.calcTrainer.getSnapshot());
    const relaunchPracticeSnapshot = await relaunchedPractice.evaluate(() => window.calcTrainer.getSnapshot());

    assert.equal(relaunchDashboardSnapshot.settings.enforcementStyle, 'lighter');
    assert.equal(relaunchDashboardSnapshot.settings.lighterReopenDelayMinutes, 3);
    assert.equal(relaunchDashboardSnapshot.activeSession.id, expectedNextSessionId);
    assert.equal(relaunchPracticeSnapshot.activeSession.id, expectedNextSessionId);

    const lighterClassName = await relaunchedDashboard
      .locator('[data-action="set-enforcement-style"][data-style="lighter"]')
      .getAttribute('class');
    assert.ok((lighterClassName || '').includes('selected'), 'Lighter button should stay selected after relaunch.');
    assert.equal(await relaunchedDashboard.locator('[data-setting-field="lighter-reopen-delay"]').inputValue(), '3');

    const consoleErrors = diagnostics.console.filter((entry) => entry.type === 'error');
    assert.equal(diagnostics.pageErrors.length, 0, `Renderer page errors: ${JSON.stringify(diagnostics.pageErrors)}`);
    assert.equal(consoleErrors.length, 0, `Renderer console errors: ${JSON.stringify(consoleErrors)}`);

    const summary = {
      status: 'passed',
      outputDir,
      profileDir: keepProfile ? profileDir : null,
      stateFile: keepProfile ? stateFile : null,
      completedSessionId: seededState.activeSessionId,
      expectedNextSessionId,
      screenshots: [
        dashboardInitialPng,
        practiceInitialPng,
        practiceAfterCompletionPng,
        dashboardAfterCompletionPng
      ],
      diagnostics
    };

    writeJson('summary.json', summary);
    console.log(`Smoke test passed. Summary: ${path.join(outputDir, 'summary.json')}`);

    if (!keepProfile) {
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  } catch (error) {
    writeFailurePayload(error);
    console.error(`Smoke test failed. Details: ${path.join(outputDir, 'failure.json')}`);
    throw error;
  } finally {
    if (watcher) {
      clearInterval(watcher);
    }
    if (electronApp) {
      await electronApp.close().catch(() => {});
    }
  }
}

process.on('uncaughtException', (error) => {
  writeFailurePayload(error);
});

process.on('unhandledRejection', (error) => {
  writeFailurePayload(error);
});

main().catch(() => {
  process.exitCode = 1;
});
