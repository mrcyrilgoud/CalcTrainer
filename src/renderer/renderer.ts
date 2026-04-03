type SelfCheckRating = 'needs_work' | 'solid';
type EnforcementStyle = 'strict' | 'lighter';
type QuestionSourceMode = 'seeded' | 'generated' | 'mixed';
type Difficulty = 'medium' | 'hard';
type SessionStatus = 'pending' | 'active' | 'completed';
type PromptType = 'multiple_choice' | 'numeric' | 'structured' | 'derivation';
type SelectionBucket = 'derivation' | 'backprop_auto' | 'cnn_auto' | 'concept';

type AttemptEvaluation = {
  correct: boolean;
  feedback: string;
  expected?: string;
};

type QuestionProgress = {
  answerText?: string;
  evaluation?: AttemptEvaluation;
  revealedSolutionAt?: string;
  selfCheck?: SelfCheckRating;
};

type AnswerSchema =
  | { kind: 'multiple_choice'; options: string[]; correctIndex: number }
  | { kind: 'numeric'; correctValue: number; tolerance: number; unitLabel?: string }
  | { kind: 'structured'; acceptableAnswers: string[]; placeholder?: string }
  | { kind: 'derivation'; checklist: string[] };

type Question = {
  id: string;
  bankQuestionId: string;
  origin: 'seeded' | 'generated';
  title: string;
  source: string;
  topicId: string;
  topicLabel: string;
  topicTag: string;
  promptType: PromptType;
  stem: string;
  hint?: string;
  workedSolution: string;
  answerSchema: AnswerSchema;
};

type PracticeSession = {
  id: string;
  slotId: string;
  scheduledFor: string;
  status: SessionStatus;
  startedAt?: string;
  minDurationMs: number;
  targetDurationMs: number;
  questions: Question[];
  responses: Record<string, QuestionProgress>;
};

type ActiveSessionStatus = {
  answeredCount: number;
  totalQuestions: number;
  minDurationMet: boolean;
  remainingMs: number;
  canComplete: boolean;
};

type ScheduleSlotView = {
  slotId: string;
  label: string;
  status: 'upcoming' | 'queued' | 'active' | 'completed';
};

type TopicScore = {
  topicId: string;
  topicTag: string;
  label: string;
  score: number;
};

type HistoryPoint = {
  dateKey: string;
  completed: number;
};

type QuestionSourceRef = {
  documentId: string;
  documentName: string;
  chunkId?: string;
  locatorLabel: string;
  excerpt: string;
  pageNumber?: number;
  slideNumber?: number;
};

type DraftValidationIssue = {
  field: string;
  message: string;
};

type GeneratedQuestionDraft = {
  id: string;
  batchId: string;
  createdAt: string;
  updatedAt: string;
  rawIndex: number;
  title: string;
  source: string;
  topicId: string;
  topicLabel: string;
  difficulty: Difficulty;
  promptType: PromptType;
  selectionBucket: SelectionBucket;
  stem: string;
  hint?: string;
  workedSolution: string;
  answerSchema: AnswerSchema;
  citations: QuestionSourceRef[];
  validationIssues: DraftValidationIssue[];
};

type QuestionGenerationBatch = {
  id: string;
  createdAt: string;
  updatedAt: string;
  documentIds: string[];
  requestedDraftCount: number;
  draftIds: string[];
  status: 'running' | 'drafts_ready' | 'partial_error' | 'generation_failed';
  generationMode: 'raw_files' | 'chunked_responses' | 'chunked_low_level';
  completedRequestCount: number;
  totalRequestCount: number;
  repairedDraftCount: number;
  errorMessage?: string;
  modelName?: string;
};

type QuestionBankDocument = {
  id: string;
  fileName: string;
  kind: 'pdf' | 'pptx';
  checksumSha256: string;
  importedAt: string;
  extractionStatus: 'pending' | 'ready' | 'failed';
  extractionError?: string;
  chunkCount: number;
};

type PublishedBankQuestion = {
  bankQuestionId: string;
  origin: 'generated';
  title: string;
  source: string;
  topicId: string;
  topicLabel: string;
  difficulty: Difficulty;
  promptType: PromptType;
  selectionBucket: SelectionBucket;
  stem: string;
  hint?: string;
  workedSolution: string;
  answerSchema: AnswerSchema;
  citations: QuestionSourceRef[];
  sourceBatchId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

type QuestionBankView = {
  documents: QuestionBankDocument[];
  batches: QuestionGenerationBatch[];
  drafts: GeneratedQuestionDraft[];
  publishedQuestions: PublishedBankQuestion[];
  publishedSummary: {
    activeCount: number;
    archivedCount: number;
    byBucket: Array<{ key: string; label: string; count: number }>;
    byTopic: Array<{ key: string; label: string; count: number }>;
    coverage: {
      generatedQuestionCount: number;
      missingBuckets: SelectionBucket[];
      requiresSeededFallback: boolean;
    };
  };
  proxyStatus: {
    configured: boolean;
    baseUrl?: string;
    model?: string;
    parseMode: 'auto' | 'raw_files' | 'chunked';
    message: string;
  };
};

type QuestionBankMutationResult = {
  ok: boolean;
  message: string;
  view: QuestionBankView;
};

type AppSnapshot = {
  now: string;
  settings: {
    timezone: string;
    activeHours: {
      startHour: number;
      endHour: number;
    };
    reminderIntervalHours: number;
    minimumSessionMinutes: number;
    targetSessionMinutes: number;
    enforcementMode: 'must_finish_session';
    enforcementStyle: EnforcementStyle;
    lighterReopenDelayMinutes: number;
    questionSourceMode: QuestionSourceMode;
  };
  activeSession: PracticeSession | null;
  activeSessionStatus: ActiveSessionStatus | null;
  schedule: ScheduleSlotView[];
  weakTopics: TopicScore[];
  history: HistoryPoint[];
  streakDays: number;
  completedToday: number;
  pendingCount: number;
  overdueSummary: string | null;
};

function snapshotContentJson(snapshot: AppSnapshot): string {
  const { now: _now, ...rest } = snapshot;
  return JSON.stringify(rest);
}

function snapshotsContentEqual(left: AppSnapshot, right: AppSnapshot): boolean {
  return snapshotContentJson(left) === snapshotContentJson(right);
}

function questionBankContentJson(view: QuestionBankView): string {
  return JSON.stringify(view);
}

function questionBankContentEqual(left: QuestionBankView | null, right: QuestionBankView | null): boolean {
  if (!left || !right) {
    return left === right;
  }
  return questionBankContentJson(left) === questionBankContentJson(right);
}

const appElement = document.getElementById('app');
const clockElement = document.getElementById('clock-pill');
const mode = new URLSearchParams(window.location.search).get('mode') === 'practice' ? 'practice' : 'dashboard';
const nativeWindowClose = window.close.bind(window);

let snapshot: AppSnapshot | null = null;
let renderedSnapshot: AppSnapshot | null = null;
let questionBankView: QuestionBankView | null = null;
let renderedQuestionBankView: QuestionBankView | null = null;
let bannerMessage = '';
const draftAnswers: Record<string, string> = {};
let selectedDocumentIds = new Set<string>();

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const GREEK_SYMBOLS: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  lambda: 'λ',
  mu: 'μ',
  omega: 'ω',
  phi: 'φ',
  psi: 'ψ',
  sigma: 'σ',
  theta: 'θ'
};

type FractionPattern = {
  pattern: RegExp;
  wrapInParentheses: boolean;
};

type MathPlaceholder = {
  token: string;
  html: string;
};

type PiecewiseClause = {
  value: string;
  condition: string;
};

const FRACTION_PATTERNS: FractionPattern[] = [
  {
    pattern: /\(\s*\(([^()]+)\)\s*\/\s*\(([^()]+)\)\s*\)/g,
    wrapInParentheses: true
  },
  {
    pattern: /\(\s*\(([^()]+)\)\s*\/\s*([A-Za-z0-9_]+(?:\^\([^)]+\)|\^[A-Za-z0-9]+)?)\s*\)/g,
    wrapInParentheses: true
  },
  {
    pattern: /\(([^()]+)\)\s*\/\s*\(([^()]+)\)/g,
    wrapInParentheses: false
  },
  {
    pattern: /\(([^()]+)\)\s*\/\s*([A-Za-z0-9_]+(?:\^\([^)]+\)|\^[A-Za-z0-9]+)?)/g,
    wrapInParentheses: false
  }
];

function createPlaceholder(placeholders: MathPlaceholder[], html: string): string {
  const token = `¤${placeholders.length}¤`;
  placeholders.push({
    token,
    html: html.replace(/\s+/g, ' ').trim()
  });
  return token;
}

function renderFractionHtml(
  numeratorHtml: string,
  denominatorHtml: string,
  options: { wrapInParentheses?: boolean; className?: string } = {}
): string {
  const className = options.className ? `math-fraction ${options.className}` : 'math-fraction';
  return `
    ${options.wrapInParentheses ? '<span class="math-fraction-group">(</span>' : ''}
    <span class="${className}">
      <span class="math-fraction-numerator">${numeratorHtml}</span>
      <span class="math-fraction-denominator">${denominatorHtml}</span>
    </span>
    ${options.wrapInParentheses ? '<span class="math-fraction-group">)</span>' : ''}
  `;
}

function formatMathTokens(input: string): string {
  return input
    .replace(/\bsum_([A-Za-z0-9]+)/g, '<span class="math-operator">∑<sub>$1</sub></span>')
    .replace(
      /\b(alpha|beta|gamma|delta|epsilon|lambda|mu|omega|phi|psi|sigma|theta)(?=(?:[_^(0-9]|\s*=))/g,
      (match) => GREEK_SYMBOLS[match] ?? match
    )
    .replace(/(^|[^\p{L}0-9])([\p{L}]+)_([A-Za-z0-9]+)/gu, '$1$2<sub>$3</sub>')
    .replace(/(^|[^\p{L}0-9])([\p{L}]+)([0-9]+)(?=(?:\^\(|\^|[\s=+\-*/,.)]|$))/gu, '$1$2<sub>$3</sub>')
    .replace(/\^\(([^)]+)\)/g, '<sup>($1)</sup>')
    .replace(/\^([A-Za-z0-9]+)/g, '<sup>$1</sup>')
    .replace(/\*/g, '&times;');
}

function replaceDerivativePlaceholders(input: string, placeholders: MathPlaceholder[]): string {
  const derivativePattern =
    /\bpartial\s+([A-Za-z0-9_]+(?:\([^)]+\))?(?:\^\([^)]+\)|\^[A-Za-z0-9]+)?)\s*\/\s*partial\s+([A-Za-z0-9_]+(?:\([^)]+\))?(?:\^\([^)]+\)|\^[A-Za-z0-9]+)?)/g;

  return input.replace(derivativePattern, (_match, numerator: string, denominator: string) => {
    return createPlaceholder(
      placeholders,
      renderFractionHtml(
        `<span class="math-derivative-symbol">∂</span>${formatMathCopy(numerator.trim())}`,
        `<span class="math-derivative-symbol">∂</span>${formatMathCopy(denominator.trim())}`,
        { className: 'math-derivative' }
      )
    );
  });
}

function replaceFractionPlaceholders(input: string, placeholders: MathPlaceholder[]): string {
  let working = input;
  let replaced = true;

  while (replaced) {
    replaced = false;
    for (const { pattern, wrapInParentheses } of FRACTION_PATTERNS) {
      pattern.lastIndex = 0;
      const next = working.replace(pattern, (_match, numerator: string, denominator: string) => {
        replaced = true;
        return createPlaceholder(
          placeholders,
          renderFractionHtml(formatMathCopy(numerator.trim()), formatMathCopy(denominator.trim()), {
            wrapInParentheses
          })
        );
      });
      working = next;
    }
  }

  return working;
}

function parsePiecewiseClause(input: string): PiecewiseClause | null {
  const normalized = input.trim().replace(/\.$/, '');
  const conditionalMatch = normalized.match(/^(.*?)\s+if\s+(.+)$/i);
  if (conditionalMatch) {
    return {
      value: conditionalMatch[1]!.trim(),
      condition: `if ${conditionalMatch[2]!.trim()}`
    };
  }

  const otherwiseMatch = normalized.match(/^(.*?)\s+otherwise$/i);
  if (!otherwiseMatch) {
    return null;
  }

  return {
    value: otherwiseMatch[1]!.trim(),
    condition: 'otherwise'
  };
}

function formatPiecewiseExpression(input: string): string | null {
  const trimmed = input.trim();
  const trailingPeriod = trimmed.endsWith('.') ? '.' : '';
  const withoutTrailingPeriod = trailingPeriod ? trimmed.slice(0, -1) : trimmed;

  const equalsIndex = withoutTrailingPeriod.indexOf('=');
  const prefix = equalsIndex >= 0 ? withoutTrailingPeriod.slice(0, equalsIndex).trim() : '';
  let body = equalsIndex >= 0 ? withoutTrailingPeriod.slice(equalsIndex + 1).trim() : withoutTrailingPeriod;

  if (body.startsWith('{') && body.endsWith('}')) {
    body = body.slice(1, -1).trim();
  }

  const rawClauses = body.split(/\s*(?:;|\n)\s*/).filter((clause) => clause.trim().length > 0);
  if (rawClauses.length < 2) {
    return null;
  }

  const clauses = rawClauses.map((clause) => parsePiecewiseClause(clause));
  if (clauses.some((clause) => clause === null)) {
    return null;
  }

  return `
    ${prefix ? `${formatMathCopy(prefix)} = ` : ''}
    <span class="math-piecewise">
      <span class="math-piecewise-brace">{</span>
      <span class="math-piecewise-rows">
        ${clauses
          .map(
            (clause) => `
              <span class="math-piecewise-row">
                <span class="math-piecewise-value">${formatMathCopy((clause as PiecewiseClause).value)}</span>
                <span class="math-piecewise-condition">${formatMathCopy((clause as PiecewiseClause).condition)}</span>
              </span>`
          )
          .join('')}
      </span>
    </span>${trailingPeriod}
  `
    .replace(/\s+/g, ' ')
    .trim();
}

function formatMathCopy(input: string): string {
  const piecewise = formatPiecewiseExpression(input);
  if (piecewise) {
    return piecewise;
  }

  const placeholders: MathPlaceholder[] = [];
  const derivativeText = replaceDerivativePlaceholders(input, placeholders);
  const text = replaceFractionPlaceholders(derivativeText, placeholders);
  let formatted = formatMathTokens(escapeHtml(text));

  for (const placeholder of placeholders) {
    formatted = formatted.split(placeholder.token).join(placeholder.html);
  }

  return formatted;
}

function formatNow(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: snapshot?.settings.timezone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date());
}

function setBanner(message: string): void {
  bannerMessage = message;
  if (!renderedSnapshot) {
    render();
    return;
  }
  updateBannerRegions();
}

function applySnapshot(nextSnapshot: AppSnapshot): void {
  snapshot = nextSnapshot;
  render();
}

function syncSelectedDocuments(): void {
  const readyDocumentIds = (questionBankView?.documents ?? [])
    .filter((document) => document.extractionStatus === 'ready')
    .map((document) => document.id);
  const readySet = new Set(readyDocumentIds);

  if (selectedDocumentIds.size === 0) {
    selectedDocumentIds = new Set(readyDocumentIds);
    return;
  }

  selectedDocumentIds = new Set([...selectedDocumentIds].filter((documentId) => readySet.has(documentId)));
  if (selectedDocumentIds.size === 0 && readyDocumentIds.length > 0) {
    selectedDocumentIds = new Set(readyDocumentIds);
  }
}

function applyQuestionBank(nextQuestionBankView: QuestionBankView): void {
  questionBankView = nextQuestionBankView;
  syncSelectedDocuments();
  render();
}

function applyQuestionBankResult(result: QuestionBankMutationResult): void {
  questionBankView = result.view;
  syncSelectedDocuments();
  setBanner(result.message);
  render();
}

function setupPracticeWindowCloseInterceptor(): void {
  if (mode !== 'practice') {
    return;
  }

  const enforcedClose = (): void => {
    if (!snapshot?.activeSession) {
      nativeWindowClose();
      return;
    }
    void window.calcTrainer.hidePracticeWindow();
  };

  try {
    Object.defineProperty(window, 'close', {
      configurable: true,
      writable: true,
      value: enforcedClose
    });
  } catch {
    window.close = enforcedClose;
  }
}

function getQuestionProgress(questionId: string): QuestionProgress {
  return snapshot?.activeSession?.responses?.[questionId] ?? {};
}

function getDraftAnswer(questionId: string): string {
  const savedAnswer = getQuestionProgress(questionId).answerText;
  return draftAnswers[questionId] ?? savedAnswer ?? '';
}

function isQuestionComplete(question: Question, progress: QuestionProgress): boolean {
  return Boolean(progress.evaluation || (progress.revealedSolutionAt && progress.selfCheck));
}

function localStatus(session: PracticeSession): ActiveSessionStatus {
  const answeredCount = session.questions.filter((question) => {
    const progress = session.responses[question.id] ?? {};
    return isQuestionComplete(question, progress);
  }).length;

  const totalQuestions = session.questions.length;
  const elapsedMs = session.startedAt ? Math.max(0, Date.now() - new Date(session.startedAt).getTime()) : 0;
  const remainingMs = Math.max(0, session.minDurationMs - elapsedMs);
  const minDurationMet = remainingMs === 0;
  return {
    answeredCount,
    totalQuestions,
    minDurationMet,
    remainingMs,
    canComplete: minDurationMet && answeredCount === totalQuestions
  };
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatDate(dateIso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(dateIso));
}

function enforcementDescription(style: EnforcementStyle): string {
  return style === 'strict'
    ? 'Strict brings the practice window to the front, keeps it floating above other windows, and reopens it quickly.'
    : 'Lighter keeps the session mandatory, but reminders reopen more gently and do not stay pinned above everything.';
}

function getDraftLighterDelay(): string {
  return String(snapshot?.settings.lighterReopenDelayMinutes ?? '');
}

function questionSourceModeDescription(modeValue: QuestionSourceMode): string {
  switch (modeValue) {
    case 'seeded':
      return 'Use only the built-in seeded bank for future sessions.';
    case 'generated':
      return 'Prefer approved generated questions and fall back to seeded ones only when coverage is incomplete.';
    case 'mixed':
    default:
      return 'Mix approved generated questions with the seeded bank for future sessions.';
  }
}

function documentStatusLabel(document: QuestionBankDocument): string {
  if (document.extractionStatus === 'ready') {
    return `${document.chunkCount} extractable chunk${document.chunkCount === 1 ? '' : 's'}`;
  }
  if (document.extractionStatus === 'failed') {
    return document.extractionError ?? 'Extraction failed';
  }
  return 'Waiting for extraction';
}

function renderBanner(): string {
  return bannerMessage ? `<div class="status-banner">${escapeHtml(bannerMessage)}</div>` : '';
}

function createElementFromHtml<T extends Element>(html: string): T {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild as T;
}

function replaceSection(sectionName: string, html: string): void {
  const current = appElement?.querySelector<HTMLElement>(`[data-section="${sectionName}"]`);
  if (!current) {
    return;
  }
  current.replaceWith(createElementFromHtml<HTMLElement>(html));
}

function refreshDocumentLibrarySection(): void {
  if (mode !== 'dashboard' || !questionBankView) {
    return;
  }
  replaceSection('dashboard-documents', renderDocumentLibrary(questionBankView));
}

function updateBannerRegions(): void {
  if (!appElement) {
    return;
  }

  const bannerHtml = renderBanner();
  for (const region of appElement.querySelectorAll<HTMLElement>('[data-live="banner-region"]')) {
    region.innerHTML = bannerHtml;
  }
}

function renderDashboardHero(snapshotValue: AppSnapshot): string {
  return `
    <article class="card hero" data-section="dashboard-hero">
      <div data-live="banner-region">${renderBanner()}</div>
      <h2 class="card-title">Mandatory practice with the actual course calculus</h2>
      <p>
        Every two hours between 9 AM and 9 PM, CalcTrainer queues a deep-learning calculus session based on Lectures 4-6 and Assignment 5.
        Sessions stay overdue until you complete the 10-minute minimum and finish the question set.
      </p>
      <div class="actions">
        <button class="primary" data-action="open-practice" ${snapshotValue.activeSession ? '' : 'disabled'}>
          ${snapshotValue.activeSession ? 'Open active session' : 'No active session yet'}
        </button>
        <button class="secondary" data-action="refresh-dashboard">Refresh state</button>
      </div>
    </article>
  `;
}

function renderDashboardSchedule(snapshotValue: AppSnapshot): string {
  return `
    <article class="card" data-section="dashboard-schedule">
      <h2 class="card-title">Today's schedule</h2>
      <div class="schedule-grid">
        ${snapshotValue.schedule
          .map(
            (slot) => `
            <div class="slot-card ${slot.status}">
              <div class="slot-label">${escapeHtml(slot.label)}</div>
              <h3>${escapeHtml(slot.status.toUpperCase())}</h3>
              <p class="subtle">${slot.status === 'completed'
                ? 'Finished.'
                : slot.status === 'active'
                  ? 'Current mandatory session.'
                  : slot.status === 'queued'
                    ? 'Queued until you clear overdue work.'
                    : 'Upcoming slot.'}</p>
            </div>`
          )
          .join('')}
      </div>
    </article>
  `;
}

function renderDashboardHistory(snapshotValue: AppSnapshot): string {
  const historyMax = Math.max(1, ...snapshotValue.history.map((entry) => entry.completed));
  return `
    <article class="card" data-section="dashboard-history">
      <h2 class="card-title">Seven-day history</h2>
      <div class="history-row">
        ${snapshotValue.history
          .map((entry) => {
            const fillHeight = `${Math.max(10, (entry.completed / historyMax) * 100)}%`;
            return `
              <div class="history-bar">
                <div class="history-fill" style="height: ${fillHeight};"></div>
                <div>
                  <strong>${entry.completed}</strong>
                  <div class="subtle">${escapeHtml(entry.dateKey.slice(5))}</div>
                </div>
              </div>`;
          })
          .join('')}
      </div>
    </article>
  `;
}

function renderDashboardPressure(snapshotValue: AppSnapshot): string {
  return `
    <article class="card" data-section="dashboard-pressure">
      <h2 class="card-title">Current pressure</h2>
      ${snapshotValue.overdueSummary
        ? `<div class="status-banner" data-live="dashboard-overdue-summary">${escapeHtml(snapshotValue.overdueSummary)}</div>`
        : '<p class="subtle">No session is active right now. The next slot will queue automatically.</p>'}
      <div class="stat-row">
        <div class="stat-box">
          <span class="stat-label">Streak</span>
          <span class="stat-value">${snapshotValue.streakDays}</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">Completed Today</span>
          <span class="stat-value">${snapshotValue.completedToday}</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">Pending Queue</span>
          <span class="stat-value">${snapshotValue.pendingCount}</span>
        </div>
      </div>
    </article>
  `;
}

function renderDashboardEnforcement(snapshotValue: AppSnapshot): string {
  return `
    <article class="card" data-section="dashboard-enforcement">
      <h2 class="card-title">Enforcement style</h2>
      <p class="subtle">${escapeHtml(enforcementDescription(snapshotValue.settings.enforcementStyle))}</p>
      <div class="segmented-control">
        <button
          class="${snapshotValue.settings.enforcementStyle === 'strict' ? 'primary selected' : 'secondary'}"
          data-action="set-enforcement-style"
          data-style="strict"
        >
          Strict
        </button>
        <button
          class="${snapshotValue.settings.enforcementStyle === 'lighter' ? 'primary selected' : 'secondary'}"
          data-action="set-enforcement-style"
          data-style="lighter"
        >
          Lighter
        </button>
      </div>
      <div class="settings-row">
        <label class="settings-field" for="lighter-reopen-delay-input">
          <span class="stat-label">Lighter reopen delay</span>
          <input
            id="lighter-reopen-delay-input"
            class="text-input settings-input"
            type="number"
            min="1"
            max="30"
            step="1"
            inputmode="numeric"
            value="${escapeHtml(getDraftLighterDelay())}"
            data-setting-field="lighter-reopen-delay"
          />
        </label>
        <button class="secondary" data-action="save-lighter-delay">Save delay</button>
      </div>
      <p class="small-copy">Used only in lighter mode. Range: 1 to 30 minutes before the practice window reopens.</p>
      <p class="small-copy">This only changes reminder behavior. Sessions still remain mandatory until completed.</p>
    </article>
  `;
}

function renderDashboardWeakTopics(snapshotValue: AppSnapshot): string {
  return `
    <article class="card" data-section="dashboard-weak-topics">
      <h2 class="card-title">Weak topics</h2>
      ${snapshotValue.weakTopics.length > 0 && snapshotValue.weakTopics.some((topic) => topic.score > 0)
        ? `
          <div class="grid">
            ${snapshotValue.weakTopics
              .map(
                (topic) => `
                <div class="stat-box">
                  <span class="stat-label">${escapeHtml(topic.label)}</span>
                  <span class="stat-value">${topic.score}</span>
                </div>`
              )
              .join('')}
          </div>`
        : '<p class="subtle">No weak-topic signal yet. The app will learn once you start answering or self-rating derivations.</p>'}
    </article>
  `;
}

function renderDashboardCoverage(): string {
  return `
    <article class="card" data-section="dashboard-coverage">
      <h2 class="card-title">Source coverage</h2>
      <p class="subtle">Lecture 4: binary backprop and activation derivatives.</p>
      <p class="subtle">Lecture 5: softmax cross-entropy, learning rate, and optimizer concepts.</p>
      <p class="subtle">Lecture 6: convolution output size, padding, stride, pooling, and parameter counts.</p>
      <p class="subtle">Assignment 5: full derivations for binary and multiclass backward passes.</p>
    </article>
  `;
}

function renderQuestionSourceCard(snapshotValue: AppSnapshot, questionBankValue: QuestionBankView | null): string {
  const coverage = questionBankValue?.publishedSummary.coverage;
  return `
    <article class="card" data-section="dashboard-question-source">
      <h2 class="card-title">Question source</h2>
      <p class="subtle">${escapeHtml(questionSourceModeDescription(snapshotValue.settings.questionSourceMode))}</p>
      <div class="segmented-control">
        ${(['seeded', 'generated', 'mixed'] as const)
          .map(
            (modeValue) => `
              <button
                class="${snapshotValue.settings.questionSourceMode === modeValue ? 'primary selected' : 'secondary'}"
                data-action="set-question-source"
                data-source-mode="${modeValue}"
              >
                ${escapeHtml(modeValue)}
              </button>`
          )
          .join('')}
      </div>
      <div class="stat-row compact-stats">
        <div class="stat-box">
          <span class="stat-label">Approved generated</span>
          <span class="stat-value">${questionBankValue?.publishedSummary.activeCount ?? 0}</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">Archived</span>
          <span class="stat-value">${questionBankValue?.publishedSummary.archivedCount ?? 0}</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">Missing buckets</span>
          <span class="stat-value">${coverage?.missingBuckets.length ?? 0}</span>
        </div>
      </div>
      ${coverage?.requiresSeededFallback
        ? `<div class="status-banner">Generated-only coverage is incomplete. CalcTrainer will fill missing slots from the seeded bank.</div>`
        : '<p class="small-copy">Generated coverage is complete for the current session shape.</p>'}
      ${coverage && coverage.missingBuckets.length > 0
        ? `<p class="small-copy">Missing buckets: ${escapeHtml(coverage.missingBuckets.join(', '))}</p>`
        : ''}
    </article>
  `;
}

function renderDocumentLibrary(questionBankValue: QuestionBankView | null): string {
  const documents = questionBankValue?.documents ?? [];
  const readyDocuments = documents.filter((document) => document.extractionStatus === 'ready');
  const generateDisabled = !questionBankValue?.proxyStatus.configured || readyDocuments.length === 0 || selectedDocumentIds.size === 0;

  return `
    <article class="card" data-section="dashboard-documents">
      <h2 class="card-title">Document library</h2>
      <p class="subtle">${escapeHtml(questionBankValue?.proxyStatus.message ?? 'Loading document and proxy state...')}</p>
      <div class="actions">
        <button class="secondary" data-action="import-documents">Import PDF or PPTX</button>
        <button class="primary" data-action="generate-drafts" ${generateDisabled ? 'disabled' : ''}>Generate draft questions</button>
      </div>
      ${documents.length === 0
        ? '<p class="small-copy">No documents imported yet.</p>'
        : `
          <div class="document-list">
            ${documents
              .map(
                (document) => `
                  <label class="document-item ${document.extractionStatus}">
                    <input
                      type="checkbox"
                      ${document.extractionStatus === 'ready' ? '' : 'disabled'}
                      ${selectedDocumentIds.has(document.id) ? 'checked' : ''}
                      data-document-id="${document.id}"
                    />
                    <div class="document-copy">
                      <strong>${escapeHtml(document.fileName)}</strong>
                      <span class="small-copy">${escapeHtml(document.kind.toUpperCase())} • ${escapeHtml(documentStatusLabel(document))}</span>
                    </div>
                  </label>`
              )
              .join('')}
          </div>`}
      ${questionBankValue?.proxyStatus.baseUrl
        ? `<p class="small-copy">Proxy: ${escapeHtml(questionBankValue.proxyStatus.baseUrl)}${questionBankValue.proxyStatus.model ? ` (${escapeHtml(questionBankValue.proxyStatus.model)})` : ''} • parse mode ${escapeHtml(questionBankValue.proxyStatus.parseMode)}</p>`
        : ''}
    </article>
  `;
}

function renderDraftIssues(draft: GeneratedQuestionDraft): string {
  if (draft.validationIssues.length === 0) {
    return '<p class="small-copy">Valid draft. You can publish it directly.</p>';
  }
  return `
    <ul class="issue-list">
      ${draft.validationIssues
        .map((issue) => `<li><strong>${escapeHtml(issue.field)}</strong>: ${escapeHtml(issue.message)}</li>`)
        .join('')}
    </ul>
  `;
}

function renderDraftSchemaEditor(draft: GeneratedQuestionDraft): string {
  switch (draft.answerSchema.kind) {
    case 'multiple_choice':
      return `
        <label class="editor-field">
          <span class="stat-label">Options</span>
          <textarea class="text-area compact-area" data-draft-field="mc-options">${escapeHtml(draft.answerSchema.options.join('\n'))}</textarea>
        </label>
        <label class="editor-field">
          <span class="stat-label">Correct index</span>
          <input class="text-input" type="number" min="0" step="1" value="${draft.answerSchema.correctIndex}" data-draft-field="mc-correct-index" />
        </label>
      `;
    case 'numeric':
      return `
        <label class="editor-field">
          <span class="stat-label">Correct value</span>
          <input class="text-input" type="number" value="${draft.answerSchema.correctValue}" data-draft-field="numeric-correct-value" />
        </label>
        <label class="editor-field">
          <span class="stat-label">Tolerance</span>
          <input class="text-input" type="number" min="0" step="0.01" value="${draft.answerSchema.tolerance}" data-draft-field="numeric-tolerance" />
        </label>
        <label class="editor-field">
          <span class="stat-label">Unit</span>
          <input class="text-input" value="${escapeHtml(draft.answerSchema.unitLabel ?? '')}" data-draft-field="numeric-unit-label" />
        </label>
      `;
    case 'structured':
      return `
        <label class="editor-field">
          <span class="stat-label">Accepted answers</span>
          <textarea class="text-area compact-area" data-draft-field="structured-answers">${escapeHtml(draft.answerSchema.acceptableAnswers.join('\n'))}</textarea>
        </label>
        <label class="editor-field">
          <span class="stat-label">Placeholder</span>
          <input class="text-input" value="${escapeHtml(draft.answerSchema.placeholder ?? '')}" data-draft-field="structured-placeholder" />
        </label>
      `;
    case 'derivation':
      return `
        <label class="editor-field full-span">
          <span class="stat-label">Checklist</span>
          <textarea class="text-area compact-area" data-draft-field="derivation-checklist">${escapeHtml(draft.answerSchema.checklist.join('\n'))}</textarea>
        </label>
      `;
  }
}

function renderDraftCard(draft: GeneratedQuestionDraft): string {
  return `
    <article class="question-card draft-card" data-draft-card="${draft.id}">
      <div class="question-top">
        <div>
          <h3 class="question-title">${escapeHtml(draft.title || 'Untitled draft')}</h3>
          <div class="inline-stack">
            <span class="badge">${escapeHtml(draft.selectionBucket)}</span>
            <span class="badge">${escapeHtml(draft.promptType)}</span>
            <span class="badge">${escapeHtml(draft.topicLabel)}</span>
          </div>
        </div>
        <div class="inline-stack">
          <button class="secondary" data-action="delete-draft" data-draft-id="${draft.id}">Delete</button>
          <button class="primary" data-action="publish-draft" data-draft-id="${draft.id}" ${draft.validationIssues.length > 0 ? 'disabled' : ''}>Publish</button>
        </div>
      </div>
      <div class="draft-editor-grid">
        <label class="editor-field">
          <span class="stat-label">Title</span>
          <input class="text-input" value="${escapeHtml(draft.title)}" data-draft-field="title" />
        </label>
        <label class="editor-field">
          <span class="stat-label">Source</span>
          <input class="text-input" value="${escapeHtml(draft.source)}" data-draft-field="source" />
        </label>
        <label class="editor-field">
          <span class="stat-label">Topic label</span>
          <input class="text-input" value="${escapeHtml(draft.topicLabel)}" data-draft-field="topicLabel" />
        </label>
        <label class="editor-field">
          <span class="stat-label">Topic ID</span>
          <input class="text-input" value="${escapeHtml(draft.topicId)}" data-draft-field="topicId" />
        </label>
        <label class="editor-field">
          <span class="stat-label">Difficulty</span>
          <select class="text-input" data-draft-field="difficulty">
            <option value="medium" ${draft.difficulty === 'medium' ? 'selected' : ''}>medium</option>
            <option value="hard" ${draft.difficulty === 'hard' ? 'selected' : ''}>hard</option>
          </select>
        </label>
        <label class="editor-field">
          <span class="stat-label">Prompt type</span>
          <select class="text-input" data-draft-field="promptType">
            <option value="multiple_choice" ${draft.promptType === 'multiple_choice' ? 'selected' : ''}>multiple_choice</option>
            <option value="numeric" ${draft.promptType === 'numeric' ? 'selected' : ''}>numeric</option>
            <option value="structured" ${draft.promptType === 'structured' ? 'selected' : ''}>structured</option>
            <option value="derivation" ${draft.promptType === 'derivation' ? 'selected' : ''}>derivation</option>
          </select>
        </label>
        <label class="editor-field">
          <span class="stat-label">Selection bucket</span>
          <select class="text-input" data-draft-field="selectionBucket">
            <option value="derivation" ${draft.selectionBucket === 'derivation' ? 'selected' : ''}>derivation</option>
            <option value="backprop_auto" ${draft.selectionBucket === 'backprop_auto' ? 'selected' : ''}>backprop_auto</option>
            <option value="cnn_auto" ${draft.selectionBucket === 'cnn_auto' ? 'selected' : ''}>cnn_auto</option>
            <option value="concept" ${draft.selectionBucket === 'concept' ? 'selected' : ''}>concept</option>
          </select>
        </label>
        <label class="editor-field full-span">
          <span class="stat-label">Stem</span>
          <textarea class="text-area compact-area" data-draft-field="stem">${escapeHtml(draft.stem)}</textarea>
        </label>
        <label class="editor-field full-span">
          <span class="stat-label">Hint</span>
          <textarea class="text-area compact-area" data-draft-field="hint">${escapeHtml(draft.hint ?? '')}</textarea>
        </label>
        <label class="editor-field full-span">
          <span class="stat-label">Worked solution</span>
          <textarea class="text-area compact-area" data-draft-field="workedSolution">${escapeHtml(draft.workedSolution)}</textarea>
        </label>
        ${renderDraftSchemaEditor(draft)}
      </div>
      <div class="feedback ${draft.validationIssues.length > 0 ? 'danger' : 'success'}">
        <strong>Validation</strong>
        ${renderDraftIssues(draft)}
      </div>
      <div class="citation-list">
        ${draft.citations
          .map(
            (citation) => `
              <div class="feedback">
                <strong>${escapeHtml(citation.documentName)} • ${escapeHtml(citation.locatorLabel)}</strong>
                ${citation.chunkId ? `<div class="small-copy">Resolved chunk: ${escapeHtml(citation.chunkId)}</div>` : '<div class="small-copy">Chunk unresolved</div>'}
                <div class="small-copy">${escapeHtml(citation.excerpt)}</div>
              </div>`
          )
          .join('')}
      </div>
      <div class="actions" style="margin-top: 16px;">
        <button class="secondary" data-action="save-draft" data-draft-id="${draft.id}">Save changes</button>
      </div>
    </article>
  `;
}

function renderDraftReviewSection(questionBankValue: QuestionBankView | null): string {
  const batches = questionBankValue?.batches ?? [];
  const drafts = questionBankValue?.drafts ?? [];
  const draftGroups = batches
    .map((batch) => ({
      batch,
      drafts: drafts.filter((draft) => draft.batchId === batch.id)
    }))
    .filter((group) => group.drafts.length > 0 || group.batch.status === 'generation_failed' || group.batch.status === 'running');

  return `
    <section class="card draft-review" data-section="dashboard-drafts">
      <div class="question-top">
        <div>
          <h2 class="card-title">Draft batch review</h2>
          <p class="subtle">Review, edit, publish, or discard generated questions before they enter the live bank.</p>
        </div>
      </div>
      ${draftGroups.length === 0
        ? '<p class="small-copy">No draft batches yet.</p>'
        : draftGroups
            .map(
              ({ batch, drafts: batchDrafts }) => `
                <section class="draft-batch">
                  <div class="question-top">
                    <div>
                      <h3 class="question-title">Batch ${escapeHtml(batch.id)}</h3>
                      <p class="small-copy">
                        Requested ${batch.requestedDraftCount} drafts
                        • mode ${escapeHtml(batch.generationMode)}
                        • status ${escapeHtml(batch.status)}
                        • requests ${batch.completedRequestCount}/${batch.totalRequestCount}
                        • repaired ${batch.repairedDraftCount}
                        ${batch.modelName ? ` • ${escapeHtml(batch.modelName)}` : ''}
                      </p>
                      ${batch.errorMessage ? `<p class="small-copy">${escapeHtml(batch.errorMessage)}</p>` : ''}
                    </div>
                    <div class="inline-stack">
                      <button
                        class="primary"
                        data-action="publish-batch"
                        data-batch-id="${batch.id}"
                        ${batchDrafts.some((draft) => draft.validationIssues.length === 0) ? '' : 'disabled'}
                      >
                        Publish all valid
                      </button>
                      <button class="secondary" data-action="discard-batch" data-batch-id="${batch.id}">Discard batch</button>
                    </div>
                  </div>
                  <div class="draft-list">
                    ${batchDrafts.map((draft) => renderDraftCard(draft)).join('')}
                  </div>
                </section>`
            )
            .join('')}
    </section>
  `;
}

function renderPublishedLibrary(questionBankValue: QuestionBankView | null): string {
  const activeQuestions = (questionBankValue?.publishedQuestions ?? []).filter((question) => !question.archivedAt);
  return `
    <article class="card" data-section="dashboard-published">
      <h2 class="card-title">Published generated bank</h2>
      ${activeQuestions.length === 0
        ? '<p class="small-copy">No approved generated questions yet.</p>'
        : `
          <div class="summary-grid">
            ${questionBankValue?.publishedSummary.byBucket
              .map((entry) => `<div class="stat-box"><span class="stat-label">${escapeHtml(entry.label)}</span><span class="stat-value">${entry.count}</span></div>`)
              .join('') ?? ''}
          </div>
          <div class="summary-grid">
            ${questionBankValue?.publishedSummary.byTopic
              .slice(0, 6)
              .map((entry) => `<div class="stat-box"><span class="stat-label">${escapeHtml(entry.label)}</span><span class="stat-value">${entry.count}</span></div>`)
              .join('') ?? ''}
          </div>
          <div class="published-list">
            ${activeQuestions
              .slice(0, 12)
              .map(
                (question) => `
                  <div class="published-item">
                    <div>
                      <strong>${escapeHtml(question.title)}</strong>
                      <div class="small-copy">${escapeHtml(question.topicLabel)} • ${escapeHtml(question.selectionBucket)}</div>
                    </div>
                    <button class="secondary" data-action="archive-published" data-published-id="${question.bankQuestionId}">Archive</button>
                  </div>`
              )
              .join('')}
          </div>`}
    </article>
  `;
}

function renderDashboard(snapshotValue: AppSnapshot, questionBankValue: QuestionBankView | null): string {
  return `
    <section class="grid" data-view="dashboard">
      <div class="grid dashboard-grid">
        <div class="grid">
          ${renderDashboardHero(snapshotValue)}
          ${renderDashboardSchedule(snapshotValue)}
          ${renderDashboardHistory(snapshotValue)}
          ${renderQuestionSourceCard(snapshotValue, questionBankValue)}
          ${renderDocumentLibrary(questionBankValue)}
        </div>

        <div class="grid">
          ${renderDashboardPressure(snapshotValue)}
          ${renderDashboardEnforcement(snapshotValue)}
          ${renderDashboardWeakTopics(snapshotValue)}
          ${renderPublishedLibrary(questionBankValue)}
          ${renderDashboardCoverage()}
        </div>
      </div>
      ${renderDraftReviewSection(questionBankValue)}
    </section>
  `;
}

function findDraft(draftId: string): GeneratedQuestionDraft | undefined {
  return questionBankView?.drafts.find((draft) => draft.id === draftId);
}

function collectDraftFields(draftId: string) {
  const card = appElement?.querySelector<HTMLElement>(`[data-draft-card="${draftId}"]`);
  const draft = findDraft(draftId);
  if (!card || !draft) {
    return null;
  }

  const readTextField = (fieldName: string): string =>
    (card.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-draft-field="${fieldName}"]`)?.value ?? '').trim();

  const promptType = readTextField('promptType') as PromptType;
  let answerSchema: AnswerSchema;
  if (promptType === 'multiple_choice') {
    answerSchema = {
      kind: 'multiple_choice',
      options: readTextField('mc-options').split('\n').map((value) => value.trim()).filter(Boolean),
      correctIndex: Number(readTextField('mc-correct-index'))
    };
  } else if (promptType === 'numeric') {
    answerSchema = {
      kind: 'numeric',
      correctValue: Number(readTextField('numeric-correct-value')),
      tolerance: Number(readTextField('numeric-tolerance')),
      unitLabel: readTextField('numeric-unit-label') || undefined
    };
  } else if (promptType === 'structured') {
    answerSchema = {
      kind: 'structured',
      acceptableAnswers: readTextField('structured-answers').split('\n').map((value) => value.trim()).filter(Boolean),
      placeholder: readTextField('structured-placeholder') || undefined
    };
  } else {
    answerSchema = {
      kind: 'derivation',
      checklist: readTextField('derivation-checklist').split('\n').map((value) => value.trim()).filter(Boolean)
    };
  }

  return {
    title: readTextField('title'),
    source: readTextField('source'),
    topicId: readTextField('topicId'),
    topicLabel: readTextField('topicLabel'),
    difficulty: readTextField('difficulty') as Difficulty,
    promptType,
    selectionBucket: readTextField('selectionBucket') as SelectionBucket,
    stem: readTextField('stem'),
    hint: readTextField('hint') || undefined,
    workedSolution: readTextField('workedSolution'),
    answerSchema,
    citations: draft.citations
  };
}

function renderFeedback(progress: QuestionProgress): string {
  if (!progress.evaluation) {
    return '';
  }
  const feedbackClass = progress.evaluation.correct ? 'feedback success' : 'feedback danger';
  const expected = progress.evaluation.correct || !progress.evaluation.expected
    ? ''
    : `<div><strong>Expected:</strong> <span class="math-copy">${formatMathCopy(progress.evaluation.expected)}</span></div>`;
  return `
    <div class="${feedbackClass}">
      <div>${escapeHtml(progress.evaluation.feedback)}</div>
      ${expected}
    </div>
  `;
}

function renderPaperReview(question: Question, progress: QuestionProgress): string {
  if (!progress.revealedSolutionAt || progress.evaluation) {
    return '';
  }

  return `
    <div class="feedback">
      <strong>Worked solution</strong>
      <div class="solution math-copy">${formatMathCopy(question.workedSolution)}</div>
      ${question.answerSchema.kind === 'derivation'
        ? `
          <ul class="checklist">
            ${question.answerSchema.checklist.map((item) => `<li class="math-copy">${formatMathCopy(item)}</li>`).join('')}
          </ul>`
        : '<p class="subtle">Compare your paper work against the solution, then rate how solid it felt.</p>'}
      <div class="inline-stack" style="margin-top: 12px;">
        <button class="secondary" data-action="self-check" data-question-id="${question.id}" data-rating="needs_work">Needs work</button>
        <button class="primary" data-action="self-check" data-question-id="${question.id}" data-rating="solid">Solid</button>
      </div>
      ${progress.selfCheck ? `<div style="margin-top: 12px;"><span class="badge ${progress.selfCheck === 'solid' ? 'success' : 'danger'}">${escapeHtml(progress.selfCheck.replace('_', ' '))}</span></div>` : ''}
    </div>
  `;
}

function renderQuestionCard(question: Question): string {
  const progress = getQuestionProgress(question.id);
  const completed = isQuestionComplete(question, progress);
  const answerValue = escapeHtml(getDraftAnswer(question.id));
  const headerBadge = completed ? '<span class="badge success">Complete</span>' : '<span class="badge">Pending</span>';

  let body = '';
  if (question.answerSchema.kind === 'multiple_choice') {
    body = `
      <div class="choice-list">
        ${question.answerSchema.options
          .map((option, index) => `
            <label class="choice-item">
              <input type="radio" name="${question.id}" value="${index}" ${getDraftAnswer(question.id) === String(index) ? 'checked' : ''} data-question-id="${question.id}" />
              <span class="math-copy">${formatMathCopy(option)}</span>
            </label>`)
          .join('')}
      </div>
      <div class="input-row">
        <button class="primary" data-action="submit-answer" data-question-id="${question.id}">Check answer</button>
      </div>
    `;
  } else if (question.answerSchema.kind === 'numeric' || question.answerSchema.kind === 'structured') {
    body = `
      <div class="input-row">
        <input class="text-input" data-question-id="${question.id}" value="${answerValue}" placeholder="${escapeHtml(question.answerSchema.kind === 'structured' ? (question.answerSchema.placeholder ?? '') : 'Enter your answer')}" />
        <button class="primary" data-action="submit-answer" data-question-id="${question.id}">Check answer</button>
        <button class="secondary" data-action="reveal-solution" data-question-id="${question.id}">Completed by paper</button>
      </div>
      ${renderPaperReview(question, progress)}
    `;
  } else {
    body = `
      <div class="input-row">
        <textarea class="text-area" data-question-id="${question.id}" placeholder="Write your derivation here before revealing the worked solution.">${answerValue}</textarea>
      </div>
      <div class="input-row">
        <button class="secondary" data-action="reveal-solution" data-question-id="${question.id}">Reveal worked solution</button>
      </div>
      ${renderPaperReview(question, progress)}
    `;
  }

  return `
    <article class="question-card" data-question-card="${question.id}">
      <div class="question-top">
        <div>
          <h3 class="question-title">${escapeHtml(question.title)}</h3>
          <div class="inline-stack">
            <span class="source-chip badge">${escapeHtml(question.source)}</span>
            <span class="badge">${escapeHtml(question.topicLabel || question.topicTag.replaceAll('_', ' '))}</span>
            ${headerBadge}
          </div>
        </div>
      </div>
      <div class="question-stem math-copy">${formatMathCopy(question.stem)}</div>
      ${question.hint ? `<p class="subtle math-copy">Hint: ${formatMathCopy(question.hint)}</p>` : ''}
      ${body}
      ${question.promptType !== 'derivation' ? renderFeedback(progress) : ''}
    </article>
  `;
}

function renderPracticeHero(snapshotValue: AppSnapshot): string {
  const session = snapshotValue.activeSession;
  if (!session) {
    return '';
  }

  const status = localStatus(session);
  return `
    <article class="card hero" data-section="practice-hero">
      <div data-live="banner-region">${renderBanner()}</div>
      <h2 class="card-title">Mandatory session for ${escapeHtml(formatDate(session.scheduledFor, snapshotValue.settings.timezone))}</h2>
      <p>
        Finish all ${status.totalQuestions} questions and stay in the session for at least 10 minutes.
        If you close this window, CalcTrainer will reopen it until the session is complete.
      </p>
      <p class="subtle">For typed calculus questions, use <strong>Completed by paper</strong> if you want to work the solution by hand and then self-check it.</p>
      <div class="practice-meta">
        <div class="meta-box">
          <span class="stat-label">Answered</span>
          <span class="stat-value" data-live="answered-count">${status.answeredCount}/${status.totalQuestions}</span>
        </div>
        <div class="meta-box">
          <span class="stat-label">Minimum Timer</span>
          <span class="stat-value" data-live="minimum-timer">${status.minDurationMet ? 'Done' : formatDuration(status.remainingMs)}</span>
        </div>
        <div class="meta-box">
          <span class="stat-label">Completion Gate</span>
          <span class="stat-value" data-live="completion-gate">${status.canComplete ? 'Unlocked' : 'Locked'}</span>
        </div>
      </div>
      <div class="actions">
        <button class="primary" data-action="complete-session" ${status.canComplete ? '' : 'disabled'}>Complete session</button>
        <button class="secondary" data-action="open-dashboard">Dashboard</button>
      </div>
    </article>
  `;
}

function renderPracticeEmptyState(): string {
  return `
    <section class="empty-state" data-view="practice-empty">
      <h2 class="title-serif">No active session</h2>
      <p class="subtle">This window will reopen automatically when the next practice slot becomes due.</p>
      <div class="actions" style="justify-content: center;">
        <button class="primary" data-action="open-dashboard">Open dashboard</button>
      </div>
    </section>
  `;
}

function renderPractice(snapshotValue: AppSnapshot): string {
  const session = snapshotValue.activeSession;
  if (!session) {
    return renderPracticeEmptyState();
  }

  return `
    <section class="grid" data-view="practice" data-session-id="${escapeHtml(session.id)}">
      ${renderPracticeHero(snapshotValue)}
      <div class="question-list" data-section="practice-questions">
        ${session.questions.map((question) => renderQuestionCard(question)).join('')}
      </div>
    </section>
  `;
}

function updateDashboardView(previousSnapshot: AppSnapshot, nextSnapshot: AppSnapshot): void {
  if (!appElement?.querySelector('[data-view="dashboard"]')) {
    appElement!.innerHTML = renderDashboard(nextSnapshot, questionBankView);
    return;
  }

  updateBannerRegions();

  if (previousSnapshot.activeSession?.id !== nextSnapshot.activeSession?.id) {
    replaceSection('dashboard-hero', renderDashboardHero(nextSnapshot));
  }
  if (JSON.stringify(previousSnapshot.schedule) !== JSON.stringify(nextSnapshot.schedule)) {
    replaceSection('dashboard-schedule', renderDashboardSchedule(nextSnapshot));
  }
  if (JSON.stringify(previousSnapshot.history) !== JSON.stringify(nextSnapshot.history)) {
    replaceSection('dashboard-history', renderDashboardHistory(nextSnapshot));
  }
  if (
    previousSnapshot.overdueSummary !== nextSnapshot.overdueSummary
    || previousSnapshot.streakDays !== nextSnapshot.streakDays
    || previousSnapshot.completedToday !== nextSnapshot.completedToday
    || previousSnapshot.pendingCount !== nextSnapshot.pendingCount
  ) {
    replaceSection('dashboard-pressure', renderDashboardPressure(nextSnapshot));
  }
  if (
    previousSnapshot.settings.enforcementStyle !== nextSnapshot.settings.enforcementStyle
    || previousSnapshot.settings.lighterReopenDelayMinutes !== nextSnapshot.settings.lighterReopenDelayMinutes
  ) {
    replaceSection('dashboard-enforcement', renderDashboardEnforcement(nextSnapshot));
  }
  if (previousSnapshot.settings.questionSourceMode !== nextSnapshot.settings.questionSourceMode) {
    replaceSection('dashboard-question-source', renderQuestionSourceCard(nextSnapshot, questionBankView));
  }
  if (JSON.stringify(previousSnapshot.weakTopics) !== JSON.stringify(nextSnapshot.weakTopics)) {
    replaceSection('dashboard-weak-topics', renderDashboardWeakTopics(nextSnapshot));
  }
}

function updatePracticeQuestionCards(previousSnapshot: AppSnapshot, nextSnapshot: AppSnapshot): void {
  const previousSession = previousSnapshot.activeSession;
  const nextSession = nextSnapshot.activeSession;
  if (!previousSession || !nextSession || previousSession.id !== nextSession.id) {
    return;
  }

  for (const question of nextSession.questions) {
    const previousProgress = previousSession.responses[question.id] ?? {};
    const nextProgress = nextSession.responses[question.id] ?? {};
    const shouldReplace = JSON.stringify(previousProgress) !== JSON.stringify(nextProgress);

    if (!shouldReplace) {
      continue;
    }

    const currentCard = appElement?.querySelector<HTMLElement>(`[data-question-card="${question.id}"]`);
    if (!currentCard) {
      continue;
    }

    currentCard.replaceWith(createElementFromHtml<HTMLElement>(renderQuestionCard(question)));
  }
}

function updatePracticeView(previousSnapshot: AppSnapshot, nextSnapshot: AppSnapshot): void {
  const existingView = appElement?.querySelector<HTMLElement>('[data-view="practice"]');
  const previousSessionId = previousSnapshot.activeSession?.id;
  const nextSessionId = nextSnapshot.activeSession?.id;

  if (!existingView || previousSessionId !== nextSessionId || !nextSessionId) {
    appElement!.innerHTML = renderPractice(nextSnapshot);
    return;
  }

  updateBannerRegions();
  updatePracticeQuestionCards(previousSnapshot, nextSnapshot);
  updatePracticeLiveState();
}

function updatePracticeLiveState(): void {
  if (mode !== 'practice' || !snapshot?.activeSession || !appElement) {
    return;
  }

  const status = localStatus(snapshot.activeSession);
  const answeredCount = appElement.querySelector<HTMLElement>('[data-live="answered-count"]');
  const minimumTimer = appElement.querySelector<HTMLElement>('[data-live="minimum-timer"]');
  const completionGate = appElement.querySelector<HTMLElement>('[data-live="completion-gate"]');
  const completeButton = appElement.querySelector<HTMLButtonElement>('[data-action="complete-session"]');

  if (answeredCount) {
    answeredCount.textContent = `${status.answeredCount}/${status.totalQuestions}`;
  }
  if (minimumTimer) {
    minimumTimer.textContent = status.minDurationMet ? 'Done' : formatDuration(status.remainingMs);
  }
  if (completionGate) {
    completionGate.textContent = status.canComplete ? 'Unlocked' : 'Locked';
  }
  if (completeButton) {
    completeButton.disabled = !status.canComplete;
  }
}

function updateDashboardLiveState(): void {
  if (mode !== 'dashboard' || !snapshot || !appElement || !clockElement) {
    return;
  }

  clockElement.textContent = formatNow();
}

async function refreshSnapshot(): Promise<void> {
  snapshot = (await window.calcTrainer.getSnapshot()) as AppSnapshot;
  render();
}

async function refreshQuestionBank(): Promise<void> {
  if (mode !== 'dashboard' || typeof window.calcTrainer.getQuestionBank !== 'function') {
    return;
  }
  questionBankView = (await window.calcTrainer.getQuestionBank()) as QuestionBankView;
  syncSelectedDocuments();
  render();
}

function render(): void {
  if (!appElement || !clockElement) {
    return;
  }
  clockElement.textContent = formatNow();
  if (!snapshot) {
    appElement.innerHTML = '<section class="empty-state"><p class="subtle">Loading application state...</p></section>';
    renderedSnapshot = null;
    return;
  }

  const previousSnapshot = renderedSnapshot;
  if (!previousSnapshot) {
    appElement.innerHTML = mode === 'practice' ? renderPractice(snapshot) : renderDashboard(snapshot, questionBankView);
    renderedSnapshot = snapshot;
    renderedQuestionBankView = questionBankView;
    return;
  }

  if (mode === 'dashboard' && !questionBankContentEqual(renderedQuestionBankView, questionBankView)) {
    appElement.innerHTML = renderDashboard(snapshot, questionBankView);
    renderedSnapshot = snapshot;
    renderedQuestionBankView = questionBankView;
    return;
  }

  if (snapshotsContentEqual(previousSnapshot, snapshot)) {
    if (mode === 'practice') {
      updatePracticeLiveState();
    } else {
      updateDashboardLiveState();
    }
    renderedSnapshot = snapshot;
    renderedQuestionBankView = questionBankView;
    return;
  }

  if (mode === 'practice') {
    updatePracticeView(previousSnapshot, snapshot);
  } else {
    updateDashboardView(previousSnapshot, snapshot);
  }
  renderedSnapshot = snapshot;
  renderedQuestionBankView = questionBankView;
}

function tickView(): void {
  if (clockElement) {
    clockElement.textContent = formatNow();
  }

  if (mode === 'practice') {
    updatePracticeLiveState();
    return;
  }

  updateDashboardLiveState();
}

appElement?.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return;
  }
  const questionId = target.dataset.questionId;
  if (!questionId) {
    return;
  }
  draftAnswers[questionId] = target.value;
});

appElement?.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  const documentId = target.dataset.documentId;
  if (documentId) {
    if (target.checked) {
      selectedDocumentIds.add(documentId);
    } else {
      selectedDocumentIds.delete(documentId);
    }
    refreshDocumentLibrarySection();
    return;
  }
  const questionId = target.dataset.questionId;
  if (!questionId) {
    return;
  }
  draftAnswers[questionId] = target.value;
});

appElement?.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest('button');
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const action = button.dataset.action;
  const questionId = button.dataset.questionId;
  if (!snapshot) {
    return;
  }

  if (action === 'open-practice') {
    await window.calcTrainer.openPractice();
    setBanner('Practice window brought to the front.');
    return;
  }

  if (action === 'open-dashboard') {
    await window.calcTrainer.openDashboard();
    setBanner('Dashboard refreshed.');
    return;
  }

  if (action === 'refresh-dashboard') {
    await refreshSnapshot();
    await refreshQuestionBank();
    setBanner('State refreshed from the main process.');
    return;
  }

  if (action === 'set-enforcement-style') {
    const enforcementStyle = button.dataset.style as EnforcementStyle | undefined;
    if (!enforcementStyle || snapshot.settings.enforcementStyle === enforcementStyle) {
      return;
    }
    applySnapshot(await window.calcTrainer.updateSettings({ enforcementStyle }) as AppSnapshot);
    setBanner(`Enforcement style set to ${enforcementStyle}.`);
    return;
  }

  if (action === 'set-question-source') {
    const questionSourceMode = button.dataset.sourceMode as QuestionSourceMode | undefined;
    if (!questionSourceMode || snapshot.settings.questionSourceMode === questionSourceMode) {
      return;
    }
    applySnapshot(await window.calcTrainer.updateSettings({ questionSourceMode }) as AppSnapshot);
    setBanner(`Question source set to ${questionSourceMode}.`);
    return;
  }

  if (action === 'save-lighter-delay') {
    const delayInput = appElement?.querySelector<HTMLInputElement>('[data-setting-field="lighter-reopen-delay"]');
    const lighterReopenDelayMinutes = Number(delayInput?.value ?? '');
    if (!Number.isFinite(lighterReopenDelayMinutes)) {
      setBanner('Enter a numeric lighter reopen delay between 1 and 30 minutes.');
      return;
    }
    applySnapshot(await window.calcTrainer.updateSettings({ lighterReopenDelayMinutes }) as AppSnapshot);
    setBanner(`Lighter reopen delay set to ${snapshot.settings.lighterReopenDelayMinutes} minute${snapshot.settings.lighterReopenDelayMinutes === 1 ? '' : 's'}.`);
    return;
  }

  if (action === 'import-documents') {
    applyQuestionBankResult(await window.calcTrainer.importDocuments() as QuestionBankMutationResult);
    return;
  }

  if (action === 'generate-drafts') {
    applyQuestionBankResult(
      await window.calcTrainer.generateDraftBatch({
        documentIds: [...selectedDocumentIds]
      }) as QuestionBankMutationResult
    );
    return;
  }

  if (action === 'save-draft') {
    const draftId = button.dataset.draftId;
    if (!draftId) {
      return;
    }
    const fields = collectDraftFields(draftId);
    if (!fields) {
      setBanner('Draft form is unavailable.');
      return;
    }
    applyQuestionBankResult(
      await window.calcTrainer.updateDraft({
        draftId,
        fields
      }) as QuestionBankMutationResult
    );
    return;
  }

  if (action === 'delete-draft') {
    const draftId = button.dataset.draftId;
    if (!draftId) {
      return;
    }
    applyQuestionBankResult(await window.calcTrainer.deleteDraft({ draftId }) as QuestionBankMutationResult);
    return;
  }

  if (action === 'publish-draft') {
    const draftId = button.dataset.draftId;
    if (!draftId) {
      return;
    }
    applyQuestionBankResult(await window.calcTrainer.publishDrafts({ draftIds: [draftId] }) as QuestionBankMutationResult);
    return;
  }

  if (action === 'publish-batch') {
    const batchId = button.dataset.batchId;
    if (!batchId || !questionBankView) {
      return;
    }
    const validDraftIds = questionBankView.drafts
      .filter((draft) => draft.batchId === batchId && draft.validationIssues.length === 0)
      .map((draft) => draft.id);
    if (validDraftIds.length === 0) {
      setBanner('No valid drafts remain in this batch.');
      return;
    }
    applyQuestionBankResult(await window.calcTrainer.publishDrafts({ draftIds: validDraftIds }) as QuestionBankMutationResult);
    return;
  }

  if (action === 'discard-batch') {
    const batchId = button.dataset.batchId;
    if (!batchId) {
      return;
    }
    applyQuestionBankResult(await window.calcTrainer.deleteDraft({ batchId }) as QuestionBankMutationResult);
    return;
  }

  if (action === 'archive-published') {
    const questionId = button.dataset.publishedId;
    if (!questionId) {
      return;
    }
    applyQuestionBankResult(await window.calcTrainer.archivePublished({ questionIds: [questionId] }) as QuestionBankMutationResult);
    return;
  }

  if (!snapshot.activeSession) {
    return;
  }

  if (action === 'complete-session') {
    const result = await window.calcTrainer.completeSession({
      sessionId: snapshot.activeSession.id
    }) as { ok: boolean; reason?: string; snapshot: AppSnapshot };
    applySnapshot(result.snapshot);
    setBanner(result.ok ? 'Session completed.' : (result.reason ?? 'Session cannot be completed yet.'));
    return;
  }

  if (!questionId) {
    return;
  }

  if (action === 'submit-answer') {
    const answerText = getDraftAnswer(questionId).trim();
    if (!answerText) {
      setBanner('Enter an answer before submitting.');
      return;
    }
    const result = await window.calcTrainer.submitAnswer({
      sessionId: snapshot.activeSession.id,
      questionId,
      answerText
    }) as { snapshot: AppSnapshot };
    snapshot = result.snapshot;
    render();
    return;
  }

  if (action === 'reveal-solution') {
    snapshot = await window.calcTrainer.revealSolution({
      sessionId: snapshot.activeSession.id,
      questionId
    }) as AppSnapshot;
    render();
    return;
  }

  if (action === 'self-check') {
    const rating = button.dataset.rating as SelfCheckRating | undefined;
    if (!rating) {
      return;
    }
    snapshot = await window.calcTrainer.selfCheck({
      sessionId: snapshot.activeSession.id,
      questionId,
      rating
    }) as AppSnapshot;
    render();
    return;
  }

});

window.calcTrainer.onSnapshot((nextSnapshot) => {
  snapshot = nextSnapshot as AppSnapshot;
  render();
});

setupPracticeWindowCloseInterceptor();
void refreshSnapshot();
if (mode === 'dashboard') {
  void refreshQuestionBank();
}
window.setInterval(() => tickView(), 1000);
