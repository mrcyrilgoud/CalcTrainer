type SelfCheckRating = 'needs_work' | 'solid';
type EnforcementStyle = 'strict' | 'lighter';

type SessionStatus = 'pending' | 'active' | 'completed';
type PromptType = 'multiple_choice' | 'numeric' | 'structured' | 'derivation';

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

type Question = {
  id: string;
  title: string;
  source: string;
  topicTag: string;
  promptType: PromptType;
  stem: string;
  hint?: string;
  workedSolution: string;
  answerSchema:
    | { kind: 'multiple_choice'; options: string[]; correctIndex: number }
    | { kind: 'numeric'; correctValue: number; tolerance: number; unitLabel?: string }
    | { kind: 'structured'; acceptableAnswers: string[]; placeholder?: string }
    | { kind: 'derivation'; checklist: string[] };
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
  topicTag: string;
  label: string;
  score: number;
};

type HistoryPoint = {
  dateKey: string;
  completed: number;
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

const appElement = document.getElementById('app');
const clockElement = document.getElementById('clock-pill');
const mode = new URLSearchParams(window.location.search).get('mode') === 'practice' ? 'practice' : 'dashboard';
const nativeWindowClose = window.close.bind(window);

let snapshot: AppSnapshot | null = null;
let renderedSnapshot: AppSnapshot | null = null;
let bannerMessage = '';
const draftAnswers: Record<string, string> = {};

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

function renderDashboard(snapshotValue: AppSnapshot): string {
  return `
    <section class="grid dashboard-grid" data-view="dashboard">
      <div class="grid">
        ${renderDashboardHero(snapshotValue)}
        ${renderDashboardSchedule(snapshotValue)}
        ${renderDashboardHistory(snapshotValue)}
      </div>

      <div class="grid">
        ${renderDashboardPressure(snapshotValue)}
        ${renderDashboardEnforcement(snapshotValue)}
        ${renderDashboardWeakTopics(snapshotValue)}
        ${renderDashboardCoverage()}
      </div>
    </section>
  `;
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
            <span class="badge">${escapeHtml(question.topicTag.replaceAll('_', ' '))}</span>
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
    appElement!.innerHTML = renderDashboard(nextSnapshot);
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
    appElement.innerHTML = mode === 'practice' ? renderPractice(snapshot) : renderDashboard(snapshot);
    renderedSnapshot = snapshot;
    return;
  }

  if (snapshotsContentEqual(previousSnapshot, snapshot)) {
    if (mode === 'practice') {
      updatePracticeLiveState();
    } else {
      updateDashboardLiveState();
    }
    renderedSnapshot = snapshot;
    return;
  }

  if (mode === 'practice') {
    updatePracticeView(previousSnapshot, snapshot);
  } else {
    updateDashboardView(previousSnapshot, snapshot);
  }
  renderedSnapshot = snapshot;
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
window.setInterval(() => tickView(), 1000);
