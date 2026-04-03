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

type StubQuestionBankView = {
  documents: any[];
  batches: any[];
  drafts: any[];
  publishedQuestions: any[];
  publishedSummary: {
    activeCount: number;
    archivedCount: number;
    byBucket: any[];
    byTopic: any[];
    coverage: {
      generatedQuestionCount: number;
      missingBuckets: string[];
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

const baseSnapshot: StubSnapshot = {
  now: new Date().toISOString(),
  settings: {
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
    lighterReopenDelayMinutes: 1,
    questionSourceMode: 'mixed'
  },
  activeSession: null,
  activeSessionStatus: null,
  schedule: [],
  weakTopics: [],
  history: [],
  streakDays: 0,
  completedToday: 0,
  pendingCount: 0,
  overdueSummary: null
};

function createQuestionBankView(): StubQuestionBankView {
  return {
    documents: [
      {
        id: 'doc-1',
        fileName: 'Lecture 4.pdf',
        kind: 'pdf',
        checksumSha256: 'checksum-1',
        importedAt: new Date().toISOString(),
        extractionStatus: 'ready',
        chunkCount: 3
      },
      {
        id: 'doc-2',
        fileName: 'lecture-slides.pptx',
        kind: 'pptx',
        checksumSha256: 'checksum-2',
        importedAt: new Date().toISOString(),
        extractionStatus: 'ready',
        chunkCount: 1
      }
    ],
    batches: [],
    drafts: [],
    publishedQuestions: [],
    publishedSummary: {
      activeCount: 0,
      archivedCount: 0,
      byBucket: [],
      byTopic: [],
      coverage: {
        generatedQuestionCount: 0,
        missingBuckets: ['derivation', 'backprop_auto', 'cnn_auto', 'concept'],
        requiresSeededFallback: true
      }
    },
    proxyStatus: {
      configured: true,
      baseUrl: 'http://proxy.test',
      parseMode: 'auto',
      message: 'Proxy configured.'
    }
  };
}

async function flushRenderer(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}

function getGenerateButton(): HTMLButtonElement | null {
  return document.querySelector('button[data-action="generate-drafts"]');
}

function getDocumentCheckboxes(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('[data-section="dashboard-documents"] input[type="checkbox"]'));
}

function setDocumentChecked(index: number, checked: boolean): void {
  const checkbox = getDocumentCheckboxes()[index];
  if (!checkbox) {
    throw new Error(`Missing checkbox at index ${index}.`);
  }
  checkbox.checked = checked;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('renderer question bank dashboard', () => {
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
    window.history.replaceState({}, '', '?mode=dashboard');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  async function loadRenderer() {
    const questionBankView = createQuestionBankView();
    const generateDraftBatch = vi.fn().mockResolvedValue({
      ok: true,
      message: 'Generated drafts.',
      view: questionBankView
    });

    Object.assign(window, {
      calcTrainer: {
        getSnapshot: vi.fn().mockResolvedValue(baseSnapshot),
        getQuestionBank: vi.fn().mockResolvedValue(questionBankView),
        openDashboard: vi.fn().mockResolvedValue(baseSnapshot),
        openPractice: vi.fn().mockResolvedValue(baseSnapshot),
        hidePracticeWindow: vi.fn().mockResolvedValue(baseSnapshot),
        importDocuments: vi.fn().mockResolvedValue({
          ok: true,
          message: 'Imported.',
          view: questionBankView
        }),
        generateDraftBatch,
        updateDraft: vi.fn(),
        deleteDraft: vi.fn(),
        publishDrafts: vi.fn(),
        archivePublished: vi.fn(),
        updateSettings: vi.fn().mockResolvedValue(baseSnapshot),
        submitAnswer: vi.fn(),
        revealSolution: vi.fn(),
        selfCheck: vi.fn(),
        completeSession: vi.fn(),
        onSnapshot: vi.fn(() => () => undefined)
      }
    });

    await import('../src/renderer/renderer');
    await flushRenderer();

    return {
      generateDraftBatch
    };
  }

  it('disables generate button when the last selected ready document is unchecked', async () => {
    await loadRenderer();

    expect(getGenerateButton()?.disabled).toBe(false);

    setDocumentChecked(0, false);
    setDocumentChecked(1, false);

    expect(getGenerateButton()?.disabled).toBe(true);
  });

  it('re-enables generate button when a ready document is reselected', async () => {
    await loadRenderer();

    setDocumentChecked(0, false);
    setDocumentChecked(1, false);
    expect(getGenerateButton()?.disabled).toBe(true);

    setDocumentChecked(1, true);

    expect(getGenerateButton()?.disabled).toBe(false);
  });

  it('does not invoke draft generation when no document remains selected', async () => {
    const { generateDraftBatch } = await loadRenderer();

    setDocumentChecked(0, false);
    setDocumentChecked(1, false);

    const generateButton = getGenerateButton();
    expect(generateButton?.disabled).toBe(true);

    generateButton?.click();
    await flushRenderer();

    expect(generateDraftBatch).not.toHaveBeenCalled();
  });

  it('preserves manual empty selection without auto-reselecting during the local refresh', async () => {
    await loadRenderer();

    setDocumentChecked(0, false);
    setDocumentChecked(1, false);

    expect(getDocumentCheckboxes()).toHaveLength(2);
    expect(getDocumentCheckboxes().every((checkbox) => checkbox.checked === false)).toBe(true);
  });
});
