import path from 'node:path';

import { app, BrowserWindow, dialog, ipcMain, Notification, shell, type OpenDialogOptions } from 'electron';

import {
  getActiveReminderRepeatMs,
  getPracticeReopenDelayMs,
  normalizeLighterReopenDelayMinutes,
  REMINDER_PULSE_MS,
  sanitizeSettings,
  shouldActivatePracticePrompt,
  shouldKeepPracticeWindowOnTop
} from './shared/settings';
import {
  archivePublishedQuestions,
  buildQuestionBankView,
  buildTopicLabelMap,
  createDefaultQuestionBankState,
  createQuestionBankPersistScheduler,
  deleteDraftFromQuestionBank,
  generateDraftBatch,
  getQuestionBankFilePath as resolveQuestionBankFilePath,
  importMarkdownQuestionFile,
  importQuestionBankFiles,
  loadQuestionBankFile,
  publishDraftsInQuestionBank,
  type QuestionBankPersistScheduler,
  updateDraftInQuestionBank
} from './shared/question-bank-storage';
import { buildSnapshot, slimDownSnapshot, SnapshotPayloadStyle } from './shared/selectors';
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
import { createDefaultState, createStatePersistScheduler, loadStateFile, type StatePersistScheduler } from './shared/storage';
import { AppSettings, AppSnapshot, AppState, DraftQuestionFields, QuestionBankState, SelfCheckRating } from './shared/types';

const DRAFT_GENERATION_TIMEOUT_MS = (() => {
  const fromEnv = Number.parseInt(process.env.CALCTRAINER_DRAFT_GENERATION_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 120_000;
})();

class TimeoutError extends Error {
  readonly code = 'timeout';
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  }) as Promise<T>;
}

function classifyError(error: unknown): { code: string; message: string } {
  if (error instanceof TimeoutError) {
    return { code: 'timeout', message: error.message };
  }
  if (error instanceof Error) {
    const message = error.message.trim().length > 0 ? error.message : 'Unexpected error.';
    return { code: error.name || 'error', message };
  }
  return { code: 'error', message: 'Unexpected error.' };
}

type IpcFailure = { ok: false; error: { code: string; message: string } };

function ipcFailure(error: unknown): IpcFailure {
  return { ok: false, error: classifyError(error) };
}

function wrapHandler<TArgs extends unknown[], TResult>(
  handler: (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> | TResult
): (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult | IpcFailure> {
  return async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (error) {
      console.error('CalcTrainer IPC handler failed.', error);
      return ipcFailure(error);
    }
  };
}

let dashboardWindow: BrowserWindow | null = null;
let practiceWindow: BrowserWindow | null = null;
let appState: AppState = createDefaultState();
let questionBankState: QuestionBankState = createDefaultQuestionBankState();
let isQuitting = false;
let reopenTimer: NodeJS.Timeout | null = null;
let reminderInterval: NodeJS.Timeout | null = null;
let statePersistScheduler: StatePersistScheduler | null = null;
let questionBankPersistScheduler: QuestionBankPersistScheduler | null = null;
type DraftGenerationLock = { abandoned: boolean };
let activeDraftGeneration: DraftGenerationLock | null = null;
const userDataOverride = process.env.CALCTRAINER_USER_DATA_DIR?.trim();
const shouldRegisterLoginItem = process.env.CALCTRAINER_DISABLE_LOGIN_ITEM !== '1';

if (userDataOverride) {
  app.setPath('userData', userDataOverride);
}

function getStateFilePath(): string {
  return path.join(app.getPath('userData'), 'calc-trainer-state.json');
}

function getQuestionBankStateFilePath(): string {
  return resolveQuestionBankFilePath(app.getPath('userData'));
}

function getRendererPath(): string {
  return path.join(__dirname, '..', 'renderer', 'index.html');
}

function isPracticeWindowWebContents(webContentsId: number): boolean {
  return Boolean(practiceWindow && !practiceWindow.isDestroyed() && practiceWindow.webContents.id === webContentsId);
}

function snapshotStyleForWebContents(webContentsId: number): SnapshotPayloadStyle {
  return isPracticeWindowWebContents(webContentsId) ? 'full' : 'slim';
}

function buildSnapshotNowForWebContents(webContentsId: number): AppSnapshot {
  const now = new Date();
  const topicLabels = buildTopicLabelMap(questionBankState);
  return snapshotStyleForWebContents(webContentsId) === 'full'
    ? getCachedFullSnapshot(now, topicLabels)
    : getCachedSlimSnapshot(now, topicLabels);
}

function getSettings(): AppSettings {
  return appState.settings;
}

function ensureStateScheduler(): StatePersistScheduler {
  if (!statePersistScheduler) {
    statePersistScheduler = createStatePersistScheduler(getStateFilePath());
  }
  return statePersistScheduler;
}

function ensureQuestionBankScheduler(): QuestionBankPersistScheduler {
  if (!questionBankPersistScheduler) {
    questionBankPersistScheduler = createQuestionBankPersistScheduler(getQuestionBankStateFilePath());
  }
  return questionBankPersistScheduler;
}

function flushPendingWrites(): void {
  statePersistScheduler?.flush();
  questionBankPersistScheduler?.flush();
}

function persistStateIfChanged(previousState: AppState, options: { skipWebContentsId?: number } = {}): void {
  if (previousState === appState) {
    return;
  }
  ensureStateScheduler().schedule(appState);
  invalidateSnapshotCache();
  broadcastSnapshot(options);
}

function persistQuestionBankIfChanged(previousState: QuestionBankState, options: { skipWebContentsId?: number } = {}): void {
  if (previousState === questionBankState) {
    return;
  }
  ensureQuestionBankScheduler().schedule(questionBankState);
  invalidateSnapshotCache();
  broadcastSnapshot(options);
}

type SnapshotCacheEntry = {
  appStateRef: AppState;
  questionBankStateRef: QuestionBankState;
  timeBucket: number;
  full: AppSnapshot | null;
  slim: AppSnapshot | null;
};

let snapshotCache: SnapshotCacheEntry | null = null;

function invalidateSnapshotCache(): void {
  snapshotCache = null;
}

function getSnapshotCacheEntry(now: Date): SnapshotCacheEntry {
  const timeBucket = Math.floor(now.getTime() / 1000);
  if (
    snapshotCache
    && snapshotCache.appStateRef === appState
    && snapshotCache.questionBankStateRef === questionBankState
    && snapshotCache.timeBucket === timeBucket
  ) {
    return snapshotCache;
  }
  snapshotCache = {
    appStateRef: appState,
    questionBankStateRef: questionBankState,
    timeBucket,
    full: null,
    slim: null
  };
  return snapshotCache;
}

function getCachedFullSnapshot(now: Date, topicLabels: Record<string, string>): AppSnapshot {
  const entry = getSnapshotCacheEntry(now);
  if (!entry.full) {
    entry.full = buildSnapshot(appState, now, 'full', { topicLabels });
  }
  return entry.full;
}

function getCachedSlimSnapshot(now: Date, topicLabels: Record<string, string>): AppSnapshot {
  const entry = getSnapshotCacheEntry(now);
  if (!entry.slim) {
    entry.slim = slimDownSnapshot(getCachedFullSnapshot(now, topicLabels));
  }
  return entry.slim;
}

function broadcastSnapshot(options: { skipWebContentsId?: number } = {}): void {
  const now = new Date();
  const topicLabels = buildTopicLabelMap(questionBankState);

  for (const candidate of [dashboardWindow, practiceWindow]) {
    if (candidate && !candidate.isDestroyed() && candidate.webContents.id !== options.skipWebContentsId) {
      const payload = isPracticeWindowWebContents(candidate.webContents.id)
        ? getCachedFullSnapshot(now, topicLabels)
        : getCachedSlimSnapshot(now, topicLabels);
      candidate.webContents.send('snapshot:updated', payload);
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
      flushPendingWrites();
      return;
    }
    const activeSession = getActiveSession(appState);
    if (!activeSession) {
      flushPendingWrites();
      return;
    }
    event.preventDefault();
    flushPendingWrites();
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
  const queueResult = queueDueSessions(appState, now, questionBankState);
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

function buildQuestionBankResult(message: string, ok = true) {
  return {
    ok,
    message,
    view: buildQuestionBankView(questionBankState)
  };
}

function registerIpc(): void {
  ipcMain.handle('snapshot:get', (event) => buildSnapshotNowForWebContents(event.sender.id));
  ipcMain.handle('questionBank:get', () => buildQuestionBankView(questionBankState));
  ipcMain.handle('dashboard:open', wrapHandler(async (event) => {
    await createDashboardWindow();
    return buildSnapshotNowForWebContents(event.sender.id);
  }));
  ipcMain.handle('practice:open', wrapHandler(async (event) => {
    await createPracticeWindow({ activate: true });
    return buildSnapshotNowForWebContents(event.sender.id);
  }));
  ipcMain.handle('practice:hide', wrapHandler((event) => {
    hidePracticeWindowForEnforcement();
    return buildSnapshotNowForWebContents(event.sender.id);
  }));
  ipcMain.handle(
    'settings:update',
    wrapHandler((
      event,
      payload: Partial<Pick<AppSettings, 'enforcementStyle' | 'lighterReopenDelayMinutes' | 'questionSourceMode'>>
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
      return buildSnapshotNowForWebContents(event.sender.id);
    })
  );
  ipcMain.handle('questionBank:importDocuments', wrapHandler(async (event) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender) ?? dashboardWindow ?? undefined;
    const dialogOptions: OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Supported documents',
          extensions: ['pdf', 'pptx']
        }
      ]
    };
    const selected = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (selected.canceled || selected.filePaths.length === 0) {
      return buildQuestionBankResult('Document import cancelled.', false);
    }

    const previousQuestionBankState = questionBankState;
    const importResult = await importQuestionBankFiles(questionBankState, selected.filePaths, app.getPath('userData'), new Date());
    questionBankState = importResult.state;
    persistQuestionBankIfChanged(previousQuestionBankState, { skipWebContentsId: event.sender.id });

    const messages = [`Imported ${importResult.importedCount} document${importResult.importedCount === 1 ? '' : 's'}.`];
    if (importResult.duplicateFiles.length > 0) {
      messages.push(`Skipped duplicates: ${importResult.duplicateFiles.join(', ')}.`);
    }
    if (importResult.unsupportedFiles.length > 0) {
      messages.push(`Unsupported files: ${importResult.unsupportedFiles.join(', ')}.`);
    }
    if (importResult.extractionFailures.length > 0) {
      messages.push(`Extraction failed for: ${importResult.extractionFailures.join(', ')}.`);
    }
    return buildQuestionBankResult(messages.join(' '), true);
  }));
  ipcMain.handle('questionBank:importMarkdownQuestions', wrapHandler(async (event) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender) ?? dashboardWindow ?? undefined;
    const dialogOptions: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        {
          name: 'Markdown',
          extensions: ['md', 'markdown']
        }
      ]
    };
    const selected = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    const [filePath] = selected.filePaths;
    if (selected.canceled || !filePath) {
      return buildQuestionBankResult('Markdown import cancelled.', false);
    }

    const previousQuestionBankState = questionBankState;
    const result = await importMarkdownQuestionFile(
      questionBankState,
      filePath,
      app.getPath('userData'),
      new Date()
    );
    questionBankState = result.state;
    persistQuestionBankIfChanged(previousQuestionBankState, { skipWebContentsId: event.sender.id });

    const ok = !result.unsupported && !result.duplicate && result.draftCount > 0;
    return buildQuestionBankResult(result.message, ok);
  }));
  ipcMain.handle('questionBank:generateDraftBatch', wrapHandler(async (event, payload: { documentIds: string[] }) => {
    if (activeDraftGeneration) {
      throw new Error('Draft generation is already in progress. Wait for the current run to finish.');
    }
    const generation: DraftGenerationLock = { abandoned: false };
    activeDraftGeneration = generation;

    const generationPromise = generateDraftBatch(
      questionBankState,
      app.getPath('userData'),
      payload.documentIds ?? [],
      new Date(),
      {
        onStateChange: (nextState) => {
          if (generation.abandoned) {
            return;
          }
          const previousQuestionBankState = questionBankState;
          questionBankState = nextState;
          persistQuestionBankIfChanged(previousQuestionBankState, { skipWebContentsId: event.sender.id });
        }
      }
    );

    // Hold the lock until the underlying generation truly settles, so a
    // second request cannot start while a timed-out generation is still running.
    const releaseLock = (): void => {
      if (activeDraftGeneration === generation) {
        activeDraftGeneration = null;
      }
    };
    generationPromise.then(releaseLock, releaseLock);

    let result: Awaited<typeof generationPromise>;
    try {
      result = await withTimeout(generationPromise, DRAFT_GENERATION_TIMEOUT_MS, 'Draft generation');
    } catch (error) {
      if (error instanceof TimeoutError) {
        // Mark the in-flight generation as abandoned so any further
        // onStateChange callbacks (and the eventual terminal result) are
        // discarded rather than overwriting newer state.
        generation.abandoned = true;
      } else {
        releaseLock();
      }
      throw error;
    }

    if (!generation.abandoned && questionBankState !== result.state) {
      const previousQuestionBankState = questionBankState;
      questionBankState = result.state;
      persistQuestionBankIfChanged(previousQuestionBankState, { skipWebContentsId: event.sender.id });
    }
    return buildQuestionBankResult(
      result.message
        ?? `Generated ${result.generatedCount} draft question${result.generatedCount === 1 ? '' : 's'} in batch ${result.batchId || 'n/a'}.`,
      result.status !== 'generation_failed'
    );
  }));
  ipcMain.handle('questionBank:updateDraft', wrapHandler((event, payload: { draftId: string; fields: Partial<DraftQuestionFields> }) => {
    const previousQuestionBankState = questionBankState;
    const result = updateDraftInQuestionBank(
      questionBankState,
      payload.draftId,
      payload.fields ?? {},
      app.getPath('userData'),
      new Date()
    );
    questionBankState = result.state;
    persistQuestionBankIfChanged(previousQuestionBankState, { skipWebContentsId: event.sender.id });
    return buildQuestionBankResult(
      result.issues.length > 0
        ? `Draft saved with ${result.issues.length} validation issue${result.issues.length === 1 ? '' : 's'}.`
        : 'Draft saved.',
      result.updated
    );
  }));
  ipcMain.handle('questionBank:deleteDraft', wrapHandler((event, payload: { draftId?: string; batchId?: string }) => {
    const previousQuestionBankState = questionBankState;
    const result = deleteDraftFromQuestionBank(questionBankState, payload ?? {}, new Date());
    questionBankState = result.state;
    persistQuestionBankIfChanged(previousQuestionBankState, { skipWebContentsId: event.sender.id });
    return buildQuestionBankResult(`Removed ${result.deletedCount} draft question${result.deletedCount === 1 ? '' : 's'}.`, result.deletedCount > 0);
  }));
  ipcMain.handle('questionBank:publishDrafts', wrapHandler((event, payload: { draftIds: string[] }) => {
    const previousQuestionBankState = questionBankState;
    const result = publishDraftsInQuestionBank(questionBankState, payload.draftIds ?? [], new Date());
    questionBankState = result.state;
    persistQuestionBankIfChanged(previousQuestionBankState, { skipWebContentsId: event.sender.id });
    const skippedSuffix = result.skippedCount > 0 ? ` ${result.skippedCount} invalid draft${result.skippedCount === 1 ? '' : 's'} were skipped.` : '';
    return buildQuestionBankResult(
      `Published ${result.publishedCount} question${result.publishedCount === 1 ? '' : 's'}.${skippedSuffix}`,
      result.publishedCount > 0
    );
  }));
  ipcMain.handle('questionBank:archivePublished', wrapHandler((event, payload: { questionIds: string[] }) => {
    const previousQuestionBankState = questionBankState;
    const result = archivePublishedQuestions(questionBankState, payload.questionIds ?? [], new Date());
    questionBankState = result.state;
    persistQuestionBankIfChanged(previousQuestionBankState, { skipWebContentsId: event.sender.id });
    return buildQuestionBankResult(
      `Archived ${result.archivedCount} published question${result.archivedCount === 1 ? '' : 's'}.`,
      result.archivedCount > 0
    );
  }));
  ipcMain.handle('session:submit-answer', wrapHandler((event, payload: { sessionId: string; questionId: string; answerText: string }) => {
    const previousState = appState;
    const result = submitAnswer(appState, payload.sessionId, payload.questionId, payload.answerText, new Date());
    appState = result.state;
    persistStateIfChanged(previousState, { skipWebContentsId: event.sender.id });
    return {
      evaluation: result.evaluation,
      snapshot: buildSnapshotNowForWebContents(event.sender.id)
    };
  }));
  ipcMain.handle('session:reveal-solution', wrapHandler((event, payload: { sessionId: string; questionId: string }) => {
    const previousState = appState;
    appState = revealWorkedSolution(appState, payload.sessionId, payload.questionId, new Date());
    persistStateIfChanged(previousState, { skipWebContentsId: event.sender.id });
    return buildSnapshotNowForWebContents(event.sender.id);
  }));
  ipcMain.handle('session:self-check', wrapHandler((event, payload: { sessionId: string; questionId: string; rating: SelfCheckRating }) => {
    const previousState = appState;
    appState = recordSelfCheck(appState, payload.sessionId, payload.questionId, payload.rating);
    persistStateIfChanged(previousState, { skipWebContentsId: event.sender.id });
    return buildSnapshotNowForWebContents(event.sender.id);
  }));
  ipcMain.handle('session:complete', wrapHandler(async (event, payload: { sessionId: string }) => {
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
      snapshot: buildSnapshotNowForWebContents(event.sender.id)
    };
  }));
}

async function bootstrap(): Promise<void> {
  if (shouldRegisterLoginItem) {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
  }
  appState = loadStateFile(getStateFilePath());
  questionBankState = loadQuestionBankFile(getQuestionBankStateFilePath());
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
  flushPendingWrites();
});

app.on('window-all-closed', () => {
  flushPendingWrites();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
