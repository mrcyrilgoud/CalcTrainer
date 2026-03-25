// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StubSnapshot = {
  now: string;
  settings: any;
  activeSession: any;
  activeSessionStatus: any;
  schedule: any[];
  weakTopics: any[];
  history: any[];
  streakDays: number;
  completedToday: number;
  pendingCount: number;
  overdueSummary: string | null;
};

const baseSettings = {
  timezone: 'America/Los_Angeles',
  activeHours: {
    startHour: 9,
    endHour: 21
  },
  reminderIntervalHours: 2,
  minimumSessionMinutes: 10,
  targetSessionMinutes: 15,
  enforcementMode: 'must_finish_session',
  enforcementStyle: 'lighter',
  lighterReopenDelayMinutes: 1
};

describe('renderer practice flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    document.body.innerHTML = `
      <div class="shell">
        <header class="masthead">
          <div id="clock-pill" class="clock-pill"></div>
        </header>
        <main id="app"></main>
      </div>
    `;
    window.history.replaceState({}, '', '?mode=practice');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('fires completeSession when the enabled practice button is clicked', async () => {
    const baseSnapshot: StubSnapshot = {
      now: new Date().toISOString(),
      settings: baseSettings,
      streakDays: 1,
      completedToday: 1,
      pendingCount: 1,
      overdueSummary: 'Active session pending.',
      weakTopics: [],
      history: [],
      schedule: [],
      activeSessionStatus: {
        answeredCount: 1,
        totalQuestions: 1,
        minDurationMet: true,
        remainingMs: 0,
        canComplete: true
      },
      activeSession: {
        id: 'session-1',
        slotId: '2026-03-24T09:00',
        scheduledFor: '2026-03-24T16:00:00.000Z',
        status: 'active',
        startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        minDurationMs: 10 * 60_000,
        targetDurationMs: 15 * 60_000,
        questions: [
          {
            id: 'q1',
            title: 'Learning Rate Failure Mode',
            source: 'Lecture 5.pdf',
            topicTag: 'learning_rate_and_optimizer',
            promptType: 'multiple_choice',
            stem: 'What happens when the learning rate is too high?',
            workedSolution: 'Overshoot.',
            answerSchema: {
              kind: 'multiple_choice',
              options: ['Wrong', 'Correct'],
              correctIndex: 1
            }
          }
        ],
        responses: {
          q1: {
            answerText: '1',
            evaluation: {
              correct: true,
              feedback: 'Correct.'
            }
          }
        }
      }
    };

    const completeSession = vi.fn().mockResolvedValue({
      ok: true,
      snapshot: {
        ...baseSnapshot,
        pendingCount: 0,
        overdueSummary: null,
        activeSession: null,
        activeSessionStatus: null
      }
    });

    const onSnapshot = vi.fn(() => () => undefined);
    const hidePracticeWindow = vi.fn().mockResolvedValue(baseSnapshot);
    const updateSettings = vi.fn().mockResolvedValue(baseSnapshot);

    Object.assign(window, {
      calcTrainer: {
        getSnapshot: vi.fn().mockResolvedValue(baseSnapshot),
        openDashboard: vi.fn().mockResolvedValue(baseSnapshot),
        openPractice: vi.fn().mockResolvedValue(baseSnapshot),
        hidePracticeWindow,
        updateSettings,
        submitAnswer: vi.fn(),
        revealSolution: vi.fn(),
        selfCheck: vi.fn(),
        completeSession,
        onSnapshot
      }
    });

    await import('../src/renderer/renderer');
    await Promise.resolve();
    await Promise.resolve();

    const completeButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Complete session')
    );

    expect(completeButton).toBeDefined();
    expect((completeButton as HTMLButtonElement).disabled).toBe(false);

    (completeButton as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(completeSession).toHaveBeenCalledWith({ sessionId: 'session-1' });
    expect(document.querySelector('[data-view="practice-empty"]')).not.toBeNull();
    expect(document.querySelector('[data-question-card]')).toBeNull();
  });

  it('routes practice window.close through hidePracticeWindow while a session is active', async () => {
    const baseSnapshot: StubSnapshot = {
      now: new Date().toISOString(),
      settings: baseSettings,
      streakDays: 0,
      completedToday: 0,
      pendingCount: 1,
      overdueSummary: 'Active session pending.',
      weakTopics: [],
      history: [],
      schedule: [],
      activeSessionStatus: {
        answeredCount: 0,
        totalQuestions: 1,
        minDurationMet: false,
        remainingMs: 60_000,
        canComplete: false
      },
      activeSession: {
        id: 'session-1',
        slotId: '2026-03-24T09:00',
        scheduledFor: '2026-03-24T16:00:00.000Z',
        status: 'active',
        startedAt: new Date().toISOString(),
        minDurationMs: 10 * 60_000,
        targetDurationMs: 15 * 60_000,
        questions: [],
        responses: {}
      }
    };

    const hidePracticeWindow = vi.fn().mockResolvedValue(baseSnapshot);

    Object.assign(window, {
      calcTrainer: {
        getSnapshot: vi.fn().mockResolvedValue(baseSnapshot),
        openDashboard: vi.fn().mockResolvedValue(baseSnapshot),
        openPractice: vi.fn().mockResolvedValue(baseSnapshot),
        hidePracticeWindow,
        updateSettings: vi.fn().mockResolvedValue(baseSnapshot),
        submitAnswer: vi.fn(),
        revealSolution: vi.fn(),
        selfCheck: vi.fn(),
        completeSession: vi.fn(),
        onSnapshot: vi.fn(() => () => undefined)
      }
    });

    await import('../src/renderer/renderer');
    await Promise.resolve();
    await Promise.resolve();

    window.close();
    await Promise.resolve();
    await Promise.resolve();

    expect(hidePracticeWindow).toHaveBeenCalledTimes(1);
  });

  it('does not replace a focused text input on the 1-second practice tick', async () => {
    const baseSnapshot: StubSnapshot = {
      now: new Date().toISOString(),
      settings: baseSettings,
      streakDays: 0,
      completedToday: 0,
      pendingCount: 1,
      overdueSummary: 'Active session pending.',
      weakTopics: [],
      history: [],
      schedule: [],
      activeSessionStatus: {
        answeredCount: 0,
        totalQuestions: 1,
        minDurationMet: false,
        remainingMs: 60_000,
        canComplete: false
      },
      activeSession: {
        id: 'session-1',
        slotId: '2026-03-24T09:00',
        scheduledFor: '2026-03-24T16:00:00.000Z',
        status: 'active',
        startedAt: new Date(Date.now() - (9 * 60_000)).toISOString(),
        minDurationMs: 10 * 60_000,
        targetDurationMs: 15 * 60_000,
        questions: [
          {
            id: 'q1',
            title: 'Binary Output Delta',
            source: 'Lecture 4.pdf',
            topicTag: 'binary_bce_backprop',
            promptType: 'structured',
            stem: 'Write dL/dz^(2).',
            workedSolution: 'a^(2) - y',
            answerSchema: {
              kind: 'structured',
              acceptableAnswers: ['a^(2)-y'],
              placeholder: 'a^(2) - y'
            }
          }
        ],
        responses: {
          q1: {}
        }
      }
    };

    Object.assign(window, {
      calcTrainer: {
        getSnapshot: vi.fn().mockResolvedValue(baseSnapshot),
        openDashboard: vi.fn().mockResolvedValue(baseSnapshot),
        openPractice: vi.fn().mockResolvedValue(baseSnapshot),
        hidePracticeWindow: vi.fn().mockResolvedValue(baseSnapshot),
        updateSettings: vi.fn().mockResolvedValue(baseSnapshot),
        submitAnswer: vi.fn(),
        revealSolution: vi.fn(),
        selfCheck: vi.fn(),
        completeSession: vi.fn(),
        onSnapshot: vi.fn(() => () => undefined)
      }
    });

    await import('../src/renderer/renderer');
    await Promise.resolve();
    await Promise.resolve();

    const input = document.querySelector('input[data-question-id="q1"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    input?.focus();
    input!.value = 'draft';
    input!.dispatchEvent(new Event('input', { bubbles: true }));

    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    const nextInput = document.querySelector('input[data-question-id="q1"]') as HTMLInputElement | null;
    expect(nextInput).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(nextInput?.value).toBe('draft');
  });

  it('only replaces the question card that changed after answer submission', async () => {
    const baseSnapshot: StubSnapshot = {
      now: new Date().toISOString(),
      settings: baseSettings,
      streakDays: 0,
      completedToday: 0,
      pendingCount: 1,
      overdueSummary: 'Active session pending.',
      weakTopics: [],
      history: [],
      schedule: [],
      activeSessionStatus: {
        answeredCount: 0,
        totalQuestions: 2,
        minDurationMet: false,
        remainingMs: 60_000,
        canComplete: false
      },
      activeSession: {
        id: 'session-1',
        slotId: '2026-03-24T09:00',
        scheduledFor: '2026-03-24T16:00:00.000Z',
        status: 'active',
        startedAt: new Date().toISOString(),
        minDurationMs: 10 * 60_000,
        targetDurationMs: 15 * 60_000,
        questions: [
          {
            id: 'q1',
            title: 'Binary Output Delta',
            source: 'Lecture 4.pdf',
            topicTag: 'binary_bce_backprop',
            promptType: 'structured',
            stem: 'Write dL/dz^(2).',
            workedSolution: 'a^(2) - y',
            answerSchema: {
              kind: 'structured',
              acceptableAnswers: ['a^(2)-y'],
              placeholder: 'a^(2) - y'
            }
          },
          {
            id: 'q2',
            title: 'Learning Rate Failure Mode',
            source: 'Lecture 5.pdf',
            topicTag: 'learning_rate_and_optimizer',
            promptType: 'multiple_choice',
            stem: 'What happens when the learning rate is too high?',
            workedSolution: 'Overshoot.',
            answerSchema: {
              kind: 'multiple_choice',
              options: ['Wrong', 'Correct'],
              correctIndex: 1
            }
          }
        ],
        responses: {
          q1: {},
          q2: {}
        }
      }
    };

    const submitAnswer = vi.fn().mockResolvedValue({
      snapshot: {
        ...baseSnapshot,
        activeSessionStatus: {
          answeredCount: 1,
          totalQuestions: 2,
          minDurationMet: false,
          remainingMs: 60_000,
          canComplete: false
        },
        activeSession: {
          ...baseSnapshot.activeSession,
          responses: {
            q1: {
              answerText: 'a^(2)-y',
              evaluation: {
                correct: true,
                feedback: 'Correct.'
              }
            },
            q2: {}
          }
        }
      }
    });

    Object.assign(window, {
      calcTrainer: {
        getSnapshot: vi.fn().mockResolvedValue(baseSnapshot),
        openDashboard: vi.fn().mockResolvedValue(baseSnapshot),
        openPractice: vi.fn().mockResolvedValue(baseSnapshot),
        hidePracticeWindow: vi.fn().mockResolvedValue(baseSnapshot),
        updateSettings: vi.fn().mockResolvedValue(baseSnapshot),
        submitAnswer,
        revealSolution: vi.fn(),
        selfCheck: vi.fn(),
        completeSession: vi.fn(),
        onSnapshot: vi.fn(() => () => undefined)
      }
    });

    await import('../src/renderer/renderer');
    await Promise.resolve();
    await Promise.resolve();

    const originalQ1 = document.querySelector('[data-question-card="q1"]');
    const originalQ2 = document.querySelector('[data-question-card="q2"]');
    const q1Input = document.querySelector('input[data-question-id="q1"]') as HTMLInputElement | null;
    const q1Submit = document.querySelector('button[data-action="submit-answer"][data-question-id="q1"]') as HTMLButtonElement | null;

    expect(originalQ1).not.toBeNull();
    expect(originalQ2).not.toBeNull();
    expect(q1Input).not.toBeNull();
    expect(q1Submit).not.toBeNull();

    q1Input!.value = 'a^(2)-y';
    q1Input!.dispatchEvent(new Event('input', { bubbles: true }));
    q1Submit!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.querySelector('[data-question-card="q1"]')).not.toBe(originalQ1);
    expect(document.querySelector('[data-question-card="q2"]')).toBe(originalQ2);
  });

  it('updates enforcement style from the dashboard controls', async () => {
    window.history.replaceState({}, '', '?mode=dashboard');

    const baseSnapshot: StubSnapshot = {
      now: new Date().toISOString(),
      settings: baseSettings,
      streakDays: 0,
      completedToday: 0,
      pendingCount: 0,
      overdueSummary: null,
      weakTopics: [],
      history: [],
      schedule: [],
      activeSession: null,
      activeSessionStatus: null
    };

    const updateSettings = vi.fn().mockResolvedValue({
      ...baseSnapshot,
      settings: {
        ...baseSettings,
        enforcementStyle: 'strict'
      }
    });

    Object.assign(window, {
      calcTrainer: {
        getSnapshot: vi.fn().mockResolvedValue(baseSnapshot),
        openDashboard: vi.fn().mockResolvedValue(baseSnapshot),
        openPractice: vi.fn().mockResolvedValue(baseSnapshot),
        hidePracticeWindow: vi.fn().mockResolvedValue(baseSnapshot),
        updateSettings,
        submitAnswer: vi.fn(),
        revealSolution: vi.fn(),
        selfCheck: vi.fn(),
        completeSession: vi.fn(),
        onSnapshot: vi.fn(() => () => undefined)
      }
    });

    await import('../src/renderer/renderer');
    await Promise.resolve();
    await Promise.resolve();

    const strictButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Strict')
    ) as HTMLButtonElement | undefined;

    expect(strictButton).toBeDefined();
    strictButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(updateSettings).toHaveBeenCalledWith({ enforcementStyle: 'strict' });
    expect(document.querySelector('button[data-style="strict"]')?.className).toContain('selected');
    expect(document.querySelector('button[data-style="lighter"]')?.className).not.toContain('selected');
  });

  it('keeps the lighter-delay dashboard input stable across the 1-second dashboard tick', async () => {
    window.history.replaceState({}, '', '?mode=dashboard');

    const baseSnapshot: StubSnapshot = {
      now: new Date().toISOString(),
      settings: baseSettings,
      streakDays: 0,
      completedToday: 0,
      pendingCount: 0,
      overdueSummary: null,
      weakTopics: [],
      history: [],
      schedule: [],
      activeSession: null,
      activeSessionStatus: null
    };

    Object.assign(window, {
      calcTrainer: {
        getSnapshot: vi.fn().mockResolvedValue(baseSnapshot),
        openDashboard: vi.fn().mockResolvedValue(baseSnapshot),
        openPractice: vi.fn().mockResolvedValue(baseSnapshot),
        hidePracticeWindow: vi.fn().mockResolvedValue(baseSnapshot),
        updateSettings: vi.fn().mockResolvedValue(baseSnapshot),
        submitAnswer: vi.fn(),
        revealSolution: vi.fn(),
        selfCheck: vi.fn(),
        completeSession: vi.fn(),
        onSnapshot: vi.fn(() => () => undefined)
      }
    });

    await import('../src/renderer/renderer');
    await Promise.resolve();
    await Promise.resolve();

    const input = document.querySelector('[data-setting-field="lighter-reopen-delay"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    input?.focus();
    input!.value = '7';
    input!.dispatchEvent(new Event('input', { bubbles: true }));

    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    const nextInput = document.querySelector('[data-setting-field="lighter-reopen-delay"]') as HTMLInputElement | null;
    expect(nextInput).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(nextInput?.value).toBe('7');
  });

  it('saves the lighter-mode reopen delay from the dashboard', async () => {
    window.history.replaceState({}, '', '?mode=dashboard');

    const baseSnapshot: StubSnapshot = {
      now: new Date().toISOString(),
      settings: baseSettings,
      streakDays: 0,
      completedToday: 0,
      pendingCount: 0,
      overdueSummary: null,
      weakTopics: [],
      history: [],
      schedule: [],
      activeSession: null,
      activeSessionStatus: null
    };

    const updateSettings = vi.fn().mockResolvedValue({
      ...baseSnapshot,
      settings: {
        ...baseSettings,
        lighterReopenDelayMinutes: 30
      }
    });

    Object.assign(window, {
      calcTrainer: {
        getSnapshot: vi.fn().mockResolvedValue(baseSnapshot),
        openDashboard: vi.fn().mockResolvedValue(baseSnapshot),
        openPractice: vi.fn().mockResolvedValue(baseSnapshot),
        hidePracticeWindow: vi.fn().mockResolvedValue(baseSnapshot),
        updateSettings,
        submitAnswer: vi.fn(),
        revealSolution: vi.fn(),
        selfCheck: vi.fn(),
        completeSession: vi.fn(),
        onSnapshot: vi.fn(() => () => undefined)
      }
    });

    await import('../src/renderer/renderer');
    await Promise.resolve();
    await Promise.resolve();

    const input = document.querySelector('[data-setting-field="lighter-reopen-delay"]') as HTMLInputElement | null;
    const saveButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Save delay')
    ) as HTMLButtonElement | undefined;

    expect(input).not.toBeNull();
    expect(saveButton).toBeDefined();

    input!.value = '999';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    saveButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(updateSettings).toHaveBeenCalledWith({ lighterReopenDelayMinutes: 999 });
    expect((document.querySelector('[data-setting-field="lighter-reopen-delay"]') as HTMLInputElement | null)?.value).toBe('30');
  });

  it('routes Completed by paper through revealSolution for typed-answer questions', async () => {
    const baseSnapshot: StubSnapshot = {
      now: new Date().toISOString(),
      settings: baseSettings,
      streakDays: 0,
      completedToday: 0,
      pendingCount: 1,
      overdueSummary: 'Active session pending.',
      weakTopics: [],
      history: [],
      schedule: [],
      activeSessionStatus: {
        answeredCount: 0,
        totalQuestions: 1,
        minDurationMet: false,
        remainingMs: 60_000,
        canComplete: false
      },
      activeSession: {
        id: 'session-1',
        slotId: '2026-03-24T09:00',
        scheduledFor: '2026-03-24T16:00:00.000Z',
        status: 'active',
        startedAt: new Date().toISOString(),
        minDurationMs: 10 * 60_000,
        targetDurationMs: 15 * 60_000,
        questions: [
          {
            id: 'q1',
            title: 'Binary Output Delta',
            source: 'Lecture 4.pdf',
            topicTag: 'binary_bce_backprop',
            promptType: 'structured',
            stem: 'Write dL/dz^(2).',
            workedSolution: 'a^(2) - y',
            answerSchema: {
              kind: 'structured',
              acceptableAnswers: ['a^(2)-y'],
              placeholder: 'a^(2) - y'
            }
          }
        ],
        responses: {
          q1: {}
        }
      }
    };

    const revealSolution = vi.fn().mockResolvedValue({
      ...baseSnapshot,
      activeSession: {
        ...baseSnapshot.activeSession,
        responses: {
          q1: {
            revealedSolutionAt: new Date().toISOString()
          }
        }
      }
    });

    Object.assign(window, {
      calcTrainer: {
        getSnapshot: vi.fn().mockResolvedValue(baseSnapshot),
        openDashboard: vi.fn().mockResolvedValue(baseSnapshot),
        openPractice: vi.fn().mockResolvedValue(baseSnapshot),
        hidePracticeWindow: vi.fn().mockResolvedValue(baseSnapshot),
        updateSettings: vi.fn().mockResolvedValue(baseSnapshot),
        submitAnswer: vi.fn(),
        revealSolution,
        selfCheck: vi.fn(),
        completeSession: vi.fn(),
        onSnapshot: vi.fn(() => () => undefined)
      }
    });

    await import('../src/renderer/renderer');
    await Promise.resolve();
    await Promise.resolve();

    const paperButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Completed by paper')
    ) as HTMLButtonElement | undefined;

    expect(paperButton).toBeDefined();
    paperButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(revealSolution).toHaveBeenCalledWith({
      sessionId: 'session-1',
      questionId: 'q1'
    });
  });

  it('shows paper self-check controls after reveal and sends the selected rating', async () => {
    const baseSnapshot: StubSnapshot = {
      now: new Date().toISOString(),
      settings: baseSettings,
      streakDays: 0,
      completedToday: 0,
      pendingCount: 1,
      overdueSummary: 'Active session pending.',
      weakTopics: [],
      history: [],
      schedule: [],
      activeSessionStatus: {
        answeredCount: 0,
        totalQuestions: 1,
        minDurationMet: false,
        remainingMs: 60_000,
        canComplete: false
      },
      activeSession: {
        id: 'session-1',
        slotId: '2026-03-24T09:00',
        scheduledFor: '2026-03-24T16:00:00.000Z',
        status: 'active',
        startedAt: new Date().toISOString(),
        minDurationMs: 10 * 60_000,
        targetDurationMs: 15 * 60_000,
        questions: [
          {
            id: 'q1',
            title: 'Convolution Output Size',
            source: 'Lecture 6.pdf',
            topicTag: 'conv_output_size',
            promptType: 'numeric',
            stem: 'Compute the output size.',
            workedSolution: '28',
            answerSchema: {
              kind: 'numeric',
              correctValue: 28,
              tolerance: 0
            }
          }
        ],
        responses: {
          q1: {}
        }
      }
    };

    const revealSnapshot = {
      ...baseSnapshot,
      activeSession: {
        ...baseSnapshot.activeSession,
        responses: {
          q1: {
            revealedSolutionAt: new Date().toISOString()
          }
        }
      }
    };

    const revealSolution = vi.fn().mockResolvedValue(revealSnapshot);
    const selfCheck = vi.fn().mockResolvedValue({
      ...revealSnapshot,
      activeSession: {
        ...revealSnapshot.activeSession,
        responses: {
          q1: {
            revealedSolutionAt: new Date().toISOString(),
            selfCheck: 'solid'
          }
        }
      },
      activeSessionStatus: {
        answeredCount: 1,
        totalQuestions: 1,
        minDurationMet: false,
        remainingMs: 60_000,
        canComplete: false
      }
    });

    Object.assign(window, {
      calcTrainer: {
        getSnapshot: vi.fn().mockResolvedValue(baseSnapshot),
        openDashboard: vi.fn().mockResolvedValue(baseSnapshot),
        openPractice: vi.fn().mockResolvedValue(baseSnapshot),
        hidePracticeWindow: vi.fn().mockResolvedValue(baseSnapshot),
        updateSettings: vi.fn().mockResolvedValue(baseSnapshot),
        submitAnswer: vi.fn(),
        revealSolution,
        selfCheck,
        completeSession: vi.fn(),
        onSnapshot: vi.fn(() => () => undefined)
      }
    });

    await import('../src/renderer/renderer');
    await Promise.resolve();
    await Promise.resolve();

    const paperButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Completed by paper')
    ) as HTMLButtonElement | undefined;
    expect(paperButton).toBeDefined();

    paperButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    const solidButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Solid')
    ) as HTMLButtonElement | undefined;
    expect(solidButton).toBeDefined();

    solidButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(selfCheck).toHaveBeenCalledWith({
      sessionId: 'session-1',
      questionId: 'q1',
      rating: 'solid'
    });
  });

  it('formats worked solutions with superscripts, subscripts, and multiplication symbols', async () => {
    const baseSnapshot: StubSnapshot = {
      now: new Date().toISOString(),
      settings: baseSettings,
      streakDays: 0,
      completedToday: 0,
      pendingCount: 1,
      overdueSummary: 'Active session pending.',
      weakTopics: [],
      history: [],
      schedule: [],
      activeSessionStatus: {
        answeredCount: 0,
        totalQuestions: 1,
        minDurationMet: false,
        remainingMs: 60_000,
        canComplete: false
      },
      activeSession: {
        id: 'session-1',
        slotId: '2026-03-24T09:00',
        scheduledFor: '2026-03-24T16:00:00.000Z',
        status: 'active',
        startedAt: new Date().toISOString(),
        minDurationMs: 10 * 60_000,
        targetDurationMs: 15 * 60_000,
        questions: [
          {
            id: 'q1',
            title: 'Binary Output Weight Gradient',
            source: 'assignment5.pdf',
            topicTag: 'binary_bce_backprop',
            promptType: 'structured',
            stem: 'Write dL/dW1^(2).',
            workedSolution: 'dL/dW1^(2) = (a^(2) - y) * a1^(1).',
            answerSchema: {
              kind: 'structured',
              acceptableAnswers: ['(a^(2)-y)*a1^(1)'],
              placeholder: '(a^(2) - y) * a1^(1)'
            }
          }
        ],
        responses: {
          q1: {}
        }
      }
    };

    const revealSolution = vi.fn().mockResolvedValue({
      ...baseSnapshot,
      activeSession: {
        ...baseSnapshot.activeSession,
        responses: {
          q1: {
            revealedSolutionAt: new Date().toISOString()
          }
        }
      }
    });

    Object.assign(window, {
      calcTrainer: {
        getSnapshot: vi.fn().mockResolvedValue(baseSnapshot),
        openDashboard: vi.fn().mockResolvedValue(baseSnapshot),
        openPractice: vi.fn().mockResolvedValue(baseSnapshot),
        hidePracticeWindow: vi.fn().mockResolvedValue(baseSnapshot),
        updateSettings: vi.fn().mockResolvedValue(baseSnapshot),
        submitAnswer: vi.fn(),
        revealSolution,
        selfCheck: vi.fn(),
        completeSession: vi.fn(),
        onSnapshot: vi.fn(() => () => undefined)
      }
    });

    await import('../src/renderer/renderer');
    await Promise.resolve();
    await Promise.resolve();

    const paperButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Completed by paper')
    ) as HTMLButtonElement | undefined;
    expect(paperButton).toBeDefined();

    paperButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    const solution = document.querySelector('.solution') as HTMLElement | null;
    expect(solution).not.toBeNull();
    expect(solution?.innerHTML).toContain('W<sub>1</sub><sup>(2)</sup>');
    expect(solution?.innerHTML).toContain('a<sub>1</sub><sup>(1)</sup>');
    expect(solution?.innerHTML).toContain('×');
  });

  it('formats greek symbols, indexed sums, and stacked fractions in worked solutions', async () => {
    const baseSnapshot: StubSnapshot = {
      now: new Date().toISOString(),
      settings: baseSettings,
      streakDays: 1,
      completedToday: 0,
      pendingCount: 1,
      overdueSummary: 'Active session pending.',
      weakTopics: [],
      history: [],
      schedule: [],
      activeSessionStatus: {
        answeredCount: 0,
        totalQuestions: 1,
        minDurationMet: false,
        remainingMs: 60_000,
        canComplete: false
      },
      activeSession: {
        id: 'session-1',
        slotId: '2026-03-24T09:00',
        scheduledFor: '2026-03-24T16:00:00.000Z',
        status: 'active',
        startedAt: new Date().toISOString(),
        minDurationMs: 10 * 60_000,
        targetDurationMs: 15 * 60_000,
        questions: [
          {
            id: 'q1',
            title: 'Indexed Recurrence',
            source: 'Lecture 5.pdf',
            topicTag: 'multiclass_softmax_cross_entropy',
            promptType: 'structured',
            stem: 'Write delta_j^(l) with sum_k and the conv formula ((n + 2p - k) / s) + 1.',
            workedSolution: 'delta_j^(l) = sum_k (Wjk^(l+1) * delta_k^(l+1)) and ((n + 2p - k) / s) + 1.',
            answerSchema: {
              kind: 'structured',
              acceptableAnswers: ['delta_j^(l)'],
              placeholder: 'delta_j^(l)'
            }
          }
        ],
        responses: {
          q1: {}
        }
      }
    };

    const revealSolution = vi.fn().mockResolvedValue({
      ...baseSnapshot,
      activeSession: {
        ...baseSnapshot.activeSession,
        responses: {
          q1: {
            revealedSolutionAt: new Date().toISOString()
          }
        }
      }
    });

    Object.assign(window, {
      calcTrainer: {
        getSnapshot: vi.fn().mockResolvedValue(baseSnapshot),
        openDashboard: vi.fn().mockResolvedValue(baseSnapshot),
        openPractice: vi.fn().mockResolvedValue(baseSnapshot),
        hidePracticeWindow: vi.fn().mockResolvedValue(baseSnapshot),
        updateSettings: vi.fn().mockResolvedValue(baseSnapshot),
        submitAnswer: vi.fn(),
        revealSolution,
        selfCheck: vi.fn(),
        completeSession: vi.fn(),
        onSnapshot: vi.fn(() => () => undefined)
      }
    });

    await import('../src/renderer/renderer');
    await Promise.resolve();
    await Promise.resolve();

    const paperButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Completed by paper')
    ) as HTMLButtonElement | undefined;

    paperButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    const solution = document.querySelector('.solution') as HTMLElement | null;
    expect(solution).not.toBeNull();
    expect(solution?.innerHTML).toContain('δ<sub>j</sub><sup>(l)</sup>');
    expect(solution?.innerHTML).toContain('∑<sub>k</sub>');
    expect(solution?.querySelector('.math-fraction')).not.toBeNull();
    expect(solution?.textContent).toContain('n + 2p - k');
    expect(solution?.textContent).toContain('s');
  });

  it('formats partial derivatives, indexed weights, and piecewise expressions', async () => {
    const baseSnapshot: StubSnapshot = {
      now: new Date().toISOString(),
      settings: baseSettings,
      streakDays: 1,
      completedToday: 0,
      pendingCount: 1,
      overdueSummary: 'Active session pending.',
      weakTopics: [],
      history: [],
      schedule: [],
      activeSessionStatus: {
        answeredCount: 0,
        totalQuestions: 1,
        minDurationMet: false,
        remainingMs: 60_000,
        canComplete: false
      },
      activeSession: {
        id: 'session-1',
        slotId: '2026-03-24T09:00',
        scheduledFor: '2026-03-24T16:00:00.000Z',
        status: 'active',
        startedAt: new Date().toISOString(),
        minDurationMs: 10 * 60_000,
        targetDurationMs: 15 * 60_000,
        questions: [
          {
            id: 'q1',
            title: 'Piecewise Gradient',
            source: 'Lecture 4.pdf',
            topicTag: 'sigmoid_tanh_relu_derivatives',
            promptType: 'structured',
            stem: 'Write partial L / partial W_jk^(l) = a_k^(l-1) if z_j^(l) > 0; 0 otherwise.',
            workedSolution: 'partial L / partial W_jk^(l) = a_k^(l-1) if z_j^(l) > 0; 0 otherwise.',
            answerSchema: {
              kind: 'structured',
              acceptableAnswers: ['partial L / partial W_jk^(l)'],
              placeholder: 'partial L / partial W_jk^(l)'
            }
          }
        ],
        responses: {
          q1: {}
        }
      }
    };

    const revealSolution = vi.fn().mockResolvedValue({
      ...baseSnapshot,
      activeSession: {
        ...baseSnapshot.activeSession,
        responses: {
          q1: {
            revealedSolutionAt: new Date().toISOString()
          }
        }
      }
    });

    Object.assign(window, {
      calcTrainer: {
        getSnapshot: vi.fn().mockResolvedValue(baseSnapshot),
        openDashboard: vi.fn().mockResolvedValue(baseSnapshot),
        openPractice: vi.fn().mockResolvedValue(baseSnapshot),
        hidePracticeWindow: vi.fn().mockResolvedValue(baseSnapshot),
        updateSettings: vi.fn().mockResolvedValue(baseSnapshot),
        submitAnswer: vi.fn(),
        revealSolution,
        selfCheck: vi.fn(),
        completeSession: vi.fn(),
        onSnapshot: vi.fn(() => () => undefined)
      }
    });

    await import('../src/renderer/renderer');
    await Promise.resolve();
    await Promise.resolve();

    const stem = document.querySelector('.question-stem') as HTMLElement | null;
    expect(stem?.querySelector('.math-derivative')).not.toBeNull();
    expect(stem?.querySelector('.math-piecewise')).not.toBeNull();

    const paperButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Completed by paper')
    ) as HTMLButtonElement | undefined;

    paperButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    const solution = document.querySelector('.solution') as HTMLElement | null;
    expect(solution).not.toBeNull();
    expect(solution?.querySelector('.math-derivative')).not.toBeNull();
    expect(solution?.querySelector('.math-piecewise')).not.toBeNull();
    expect(solution?.innerHTML).toContain('W<sub>jk</sub><sup>(l)</sup>');
    expect(solution?.innerHTML).toContain('a<sub>k</sub><sup>(l-1)</sup>');
    expect(solution?.innerHTML).toContain('z<sub>j</sub><sup>(l)</sup> &gt; 0');
    expect(solution?.textContent).toContain('otherwise');
    expect(solution?.textContent).toContain('∂');
  });
});
