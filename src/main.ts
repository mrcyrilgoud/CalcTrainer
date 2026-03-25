import path from 'node:path';

import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron';

import {
  getActiveReminderRepeatMs,
  getPracticeReopenDelayMs,
  normalizeLighterReopenDelayMinutes,
  REMINDER_PULSE_MS,
  sanitizeSettings,
  shouldActivatePracticePrompt,
  shouldKeepPracticeWindowOnTop
} from './shared/settings';
import { buildSnapshot } from './shared/selectors';
import { queueDueSessions } from './shared/schedule';
import {
  completeSession,
  findSession,
  getActiveSession,
  markSessionPrompted,
  recordSelfCheck,
  revealWorkedSolution,
  submitAnswer
} from './shared/practice';
import { createDefaultState, loadStateFile, saveStateFile } from './shared/storage';
import { AppSettings, AppSnapshot, AppState, SelfCheckRating } from './shared/types';

let dashboardWindow: BrowserWindow | null = null;
let practiceWindow: BrowserWindow | null = null;
let appState: AppState = createDefaultState();
let isQuitting = false;
let reopenTimer: NodeJS.Timeout | null = null;
let reminderInterval: NodeJS.Timeout | null = null;
const userDataOverride = process.env.CALCTRAINER_USER_DATA_DIR?.trim();
const shouldRegisterLoginItem = process.env.CALCTRAINER_DISABLE_LOGIN_ITEM !== '1';

if (userDataOverride) {
  app.setPath('userData', userDataOverride);
}

function getStateFilePath(): string {
  return path.join(app.getPath('userData'), 'calc-trainer-state.json');
}

function getRendererPath(): string {
  return path.join(__dirname, '..', 'renderer', 'index.html');
}

function buildSnapshotNow(): AppSnapshot {
  return buildSnapshot(appState, new Date());
}

function getSettings(): AppSettings {
  return appState.settings;
}

function persistStateIfChanged(previousState: AppState, options: { skipWebContentsId?: number } = {}): void {
  if (previousState === appState) {
    return;
  }
  saveStateFile(getStateFilePath(), appState);
  broadcastSnapshot(options);
}

function broadcastSnapshot(options: { skipWebContentsId?: number } = {}): void {
  const snapshot = buildSnapshotNow();
  for (const candidate of [dashboardWindow, practiceWindow]) {
    if (candidate && !candidate.isDestroyed() && candidate.webContents.id !== options.skipWebContentsId) {
      candidate.webContents.send('snapshot:updated', snapshot);
    }
  }
}

async function createDashboardWindow(): Promise<BrowserWindow> {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
    return dashboardWindow;
  }

  dashboardWindow = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 1080,
    minHeight: 760,
    backgroundColor: '#efe4cf',
    title: 'CalcTrainer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });

  await dashboardWindow.loadFile(getRendererPath(), {
    query: { mode: 'dashboard' }
  });
  return dashboardWindow;
}

function revealPracticeWindow(activate: boolean): void {
  if (!practiceWindow || practiceWindow.isDestroyed()) {
    return;
  }

  const keepOnTop = shouldKeepPracticeWindowOnTop(getSettings());
  practiceWindow.setAlwaysOnTop(keepOnTop, keepOnTop ? 'floating' : 'normal');
  if (activate) {
    practiceWindow.show();
    practiceWindow.focus();
    return;
  }

  practiceWindow.showInactive();
}

function clearReopenTimer(): void {
  if (reopenTimer) {
    clearTimeout(reopenTimer);
    reopenTimer = null;
  }
}

function schedulePracticeReopen(): void {
  clearReopenTimer();
  reopenTimer = setTimeout(() => {
    const activeSession = getActiveSession(appState);
    if (!activeSession) {
      return;
    }
    void promptSession(activeSession.id, 'Practice session still required.');
  }, getPracticeReopenDelayMs(getSettings()));
}

function hidePracticeWindowForEnforcement(): void {
  if (!practiceWindow || practiceWindow.isDestroyed()) {
    return;
  }

  practiceWindow.hide();
  if (getActiveSession(appState)) {
    schedulePracticeReopen();
  } else {
    clearReopenTimer();
  }
}

async function createPracticeWindow(options: { activate?: boolean } = {}): Promise<BrowserWindow> {
  const activate = options.activate ?? false;
  if (practiceWindow && !practiceWindow.isDestroyed()) {
    revealPracticeWindow(activate);
    clearReopenTimer();
    return practiceWindow;
  }

  practiceWindow = new BrowserWindow({
    width: 960,
    height: 780,
    minWidth: 820,
    minHeight: 680,
    backgroundColor: '#f3ead8',
    title: 'CalcTrainer Practice',
    alwaysOnTop: shouldKeepPracticeWindowOnTop(getSettings()),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  practiceWindow.on('close', (event) => {
    if (isQuitting) {
      return;
    }
    const activeSession = getActiveSession(appState);
    if (!activeSession) {
      return;
    }
    event.preventDefault();
    hidePracticeWindowForEnforcement();
  });

  practiceWindow.on('closed', () => {
    practiceWindow = null;
  });

  await practiceWindow.loadFile(getRendererPath(), {
    query: { mode: 'practice' }
  });
  revealPracticeWindow(activate);
  return practiceWindow;
}

function showNotification(title: string, body: string): void {
  if (!Notification.isSupported()) {
    shell.beep();
    return;
  }

  const notification = new Notification({ title, body, urgency: 'critical' });
  notification.on('click', () => {
    void createPracticeWindow({ activate: true });
  });
  notification.show();
}

async function promptSession(sessionId: string, body: string, options: { skipWebContentsId?: number } = {}): Promise<void> {
  const session = findSession(appState, sessionId);
  if (!session) {
    return;
  }

  const previousState = appState;
  appState = markSessionPrompted(appState, sessionId, new Date());
  persistStateIfChanged(previousState, options);
  showNotification('CalcTrainer session due', body);
  if (process.platform === 'darwin' && app.dock) {
    app.dock.bounce('critical');
  }
  await createPracticeWindow({ activate: shouldActivatePracticePrompt(getSettings()) });
}

function runScheduler(): void {
  const now = new Date();
  const previousState = appState;
  const previousActiveSessionId = previousState.activeSessionId;
  const queueResult = queueDueSessions(appState, now);
  appState = queueResult.state;
  persistStateIfChanged(previousState);

  if (queueResult.activatedSessionId && queueResult.activatedSessionId !== previousActiveSessionId) {
    void promptSession(queueResult.activatedSessionId, 'A scheduled deep-learning calculus session is now active.');
    return;
  }

  const activeSession = getActiveSession(appState);
  if (!activeSession) {
    return;
  }

  const lastPromptedAt = activeSession.lastPromptedAt ? new Date(activeSession.lastPromptedAt).getTime() : 0;
  const reminderDue = now.getTime() - lastPromptedAt >= getActiveReminderRepeatMs(getSettings());
  const practiceVisible = Boolean(practiceWindow && !practiceWindow.isDestroyed() && practiceWindow.isVisible());

  if (!practiceVisible && reminderDue) {
    void promptSession(activeSession.id, 'Your current CalcTrainer session is still overdue.');
  }
}

function registerIpc(): void {
  ipcMain.handle('snapshot:get', () => buildSnapshotNow());
  ipcMain.handle('dashboard:open', async () => {
    await createDashboardWindow();
    return buildSnapshotNow();
  });
  ipcMain.handle('practice:open', async () => {
    await createPracticeWindow({ activate: true });
    return buildSnapshotNow();
  });
  ipcMain.handle('practice:hide', () => {
    hidePracticeWindowForEnforcement();
    return buildSnapshotNow();
  });
  ipcMain.handle(
    'settings:update',
    (
      event,
      payload: Partial<Pick<AppSettings, 'enforcementStyle' | 'lighterReopenDelayMinutes'>>
    ) => {
      const nextSettings = sanitizeSettings({
        ...appState.settings,
        ...payload,
        lighterReopenDelayMinutes:
          payload.lighterReopenDelayMinutes === undefined
            ? appState.settings.lighterReopenDelayMinutes
            : normalizeLighterReopenDelayMinutes(payload.lighterReopenDelayMinutes)
      });

      const previousState = appState;
      appState = {
        ...appState,
        settings: nextSettings
      };
      persistStateIfChanged(previousState, { skipWebContentsId: event.sender.id });
      if (practiceWindow && !practiceWindow.isDestroyed()) {
        const keepOnTop = shouldKeepPracticeWindowOnTop(getSettings());
        practiceWindow.setAlwaysOnTop(keepOnTop, keepOnTop ? 'floating' : 'normal');
      }
      return buildSnapshotNow();
    }
  );
  ipcMain.handle('session:submit-answer', (event, payload: { sessionId: string; questionId: string; answerText: string }) => {
    const previousState = appState;
    const result = submitAnswer(appState, payload.sessionId, payload.questionId, payload.answerText, new Date());
    appState = result.state;
    persistStateIfChanged(previousState, { skipWebContentsId: event.sender.id });
    return {
      evaluation: result.evaluation,
      snapshot: buildSnapshotNow()
    };
  });
  ipcMain.handle('session:reveal-solution', (event, payload: { sessionId: string; questionId: string }) => {
    const previousState = appState;
    appState = revealWorkedSolution(appState, payload.sessionId, payload.questionId, new Date());
    persistStateIfChanged(previousState, { skipWebContentsId: event.sender.id });
    return buildSnapshotNow();
  });
  ipcMain.handle('session:self-check', (event, payload: { sessionId: string; questionId: string; rating: SelfCheckRating }) => {
    const previousState = appState;
    appState = recordSelfCheck(appState, payload.sessionId, payload.questionId, payload.rating);
    persistStateIfChanged(previousState, { skipWebContentsId: event.sender.id });
    return buildSnapshotNow();
  });
  ipcMain.handle('session:complete', async (event, payload: { sessionId: string }) => {
    const previousState = appState;
    const completion = completeSession(appState, payload.sessionId, new Date());
    appState = completion.state;
    persistStateIfChanged(previousState, { skipWebContentsId: event.sender.id });
    if (completion.completed && completion.activatedSessionId) {
      await promptSession(completion.activatedSessionId, 'Another overdue session is queued and now active.', {
        skipWebContentsId: event.sender.id
      });
    }
    return {
      ok: completion.completed,
      reason: completion.reason,
      snapshot: buildSnapshotNow()
    };
  });
}

async function bootstrap(): Promise<void> {
  if (shouldRegisterLoginItem) {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
  }
  appState = loadStateFile(getStateFilePath());
  registerIpc();
  const loginItemSettings = shouldRegisterLoginItem ? app.getLoginItemSettings() : null;
  const launchedAtLogin = Boolean(loginItemSettings?.wasOpenedAtLogin || loginItemSettings?.wasOpenedAsHidden);
  if (!launchedAtLogin) {
    await createDashboardWindow();
  }
  runScheduler();
  reminderInterval = setInterval(runScheduler, REMINDER_PULSE_MS);
}

app.whenReady().then(() => {
  void bootstrap();
});

app.on('activate', () => {
  if (!dashboardWindow) {
    void createDashboardWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  clearReopenTimer();
  if (reminderInterval) {
    clearInterval(reminderInterval);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
