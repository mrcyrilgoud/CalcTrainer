import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';

import {
  buildQuestionBankView,
  createDefaultQuestionBankState,
  generateDraftBatch,
  getExtractedTextDir,
  getManagedDocumentsDir,
  importQuestionBankFiles,
  publishDraftsInQuestionBank
} from '../src/shared/question-bank-storage';
import { submitAnswer } from '../src/shared/practice';
import { queueDueSessions } from '../src/shared/schedule';
import { createDefaultState } from '../src/shared/storage';
import { AnswerSchema, GeneratedQuestionDraft, QuestionGenerationBatch, QuestionSourceRef } from '../src/shared/types';

function makeDate(hour: number, minute = 0): Date {
  return new Date(2026, 2, 23, hour, minute, 0, 0);
}

async function createMinimalPptx(filePath: string, slideText: string): Promise<void> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
        <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
      </Types>`
  );
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
      </p:presentation>`
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
      </Relationships>`
  );
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld>
          <p:spTree>
            <p:sp>
              <p:txBody>
                <a:p><a:r><a:t>${slideText}</a:t></a:r></a:p>
              </p:txBody>
            </p:sp>
          </p:spTree>
        </p:cSld>
      </p:sld>`
  );

  fs.writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
}

function makeCitation(documentId: string, documentName: string, locatorLabel: string): QuestionSourceRef {
  return {
    documentId,
    documentName,
    chunkId: `${documentId}-chunk`,
    locatorLabel,
    excerpt: 'Excerpt from the supporting material.'
  };
}

function makeDraft(
  overrides: Partial<GeneratedQuestionDraft> & {
    id: string;
    batchId: string;
    citations: QuestionSourceRef[];
    answerSchema: AnswerSchema;
  }
): GeneratedQuestionDraft {
  return {
    id: overrides.id,
    batchId: overrides.batchId,
    createdAt: new Date('2026-03-23T10:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-03-23T10:00:00.000Z').toISOString(),
    rawIndex: overrides.rawIndex ?? 0,
    title: overrides.title ?? 'Generated prompt',
    source: overrides.source ?? 'Imported source',
    topicId: overrides.topicId ?? 'generated_topic',
    topicLabel: overrides.topicLabel ?? 'Generated topic',
    difficulty: overrides.difficulty ?? 'medium',
    promptType: overrides.promptType ?? overrides.answerSchema.kind,
    selectionBucket: overrides.selectionBucket ?? 'concept',
    stem: overrides.stem ?? 'Explain the generated concept.',
    hint: overrides.hint,
    workedSolution: overrides.workedSolution ?? 'Generated answer.',
    answerSchema: overrides.answerSchema,
    citations: overrides.citations,
    validationIssues: overrides.validationIssues ?? []
  };
}

function makeBatch(batchId: string, draftIds: string[]): QuestionGenerationBatch {
  return {
    id: batchId,
    createdAt: new Date('2026-03-23T10:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-03-23T10:00:00.000Z').toISOString(),
    documentIds: draftIds.map((draftId) => `doc-${draftId}`),
    requestedDraftCount: draftIds.length,
    draftIds,
    generationMode: 'chunked_responses',
    completedRequestCount: 1,
    totalRequestCount: 1,
    repairedDraftCount: 0,
    status: 'partial_error',
    modelName: 'fake-model'
  };
}

function makeReadyDocumentState(userDataDir: string) {
  const state = createDefaultQuestionBankState(new Date('2026-03-23T10:00:00.000Z'));
  const documentId = 'doc-generated';
  state.documents = [
    {
      id: documentId,
      fileName: 'Lecture 4.pdf',
      kind: 'pdf',
      checksumSha256: 'checksum-1',
      importedAt: new Date('2026-03-23T10:00:00.000Z').toISOString(),
      storedFileName: 'doc-generated.pdf',
      extractedTextFileName: `${documentId}.json`,
      extractionStatus: 'ready',
      chunkCount: 1
    }
  ];

  fs.mkdirSync(getManagedDocumentsDir(userDataDir), { recursive: true });
  fs.writeFileSync(path.join(getManagedDocumentsDir(userDataDir), 'doc-generated.pdf'), 'fake pdf bytes', 'utf8');
  fs.mkdirSync(getExtractedTextDir(userDataDir), { recursive: true });
  fs.writeFileSync(
    path.join(getExtractedTextDir(userDataDir), `${documentId}.json`),
    JSON.stringify(
      [
        {
          id: 'page-1',
          order: 1,
          text: 'Sigmoid derivative is sigma(x) * (1 - sigma(x)).',
          locatorLabel: 'Page 1',
          pageNumber: 1
        }
      ],
      null,
      2
    ),
    'utf8'
  );

  return { state, documentId };
}

describe('question bank pipeline', () => {
  it('imports PDF and PPTX documents, extracts ordered text, deduplicates files, and rejects unsupported files', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calctrainer-bank-'));
    const userDataDir = path.join(tempDir, 'user-data');
    const pptxPath = path.join(tempDir, 'mini-deck.pptx');
    const txtPath = path.join(tempDir, 'notes.txt');
    await createMinimalPptx(pptxPath, 'Dynamic question bank slide');
    fs.writeFileSync(txtPath, 'unsupported', 'utf8');

    const pdfPath = path.join(process.cwd(), 'Data 255 Math', 'Lecture 4.pdf');
    const result = await importQuestionBankFiles(
      createDefaultQuestionBankState(new Date('2026-03-23T10:00:00.000Z')),
      [pdfPath, pptxPath, pptxPath, txtPath],
      userDataDir,
      new Date('2026-03-23T10:00:00.000Z')
    );

    expect(result.importedCount).toBe(2);
    expect(result.duplicateFiles).toContain('mini-deck.pptx');
    expect(result.unsupportedFiles).toContain('notes.txt');
    expect(result.state.documents.map((document) => document.kind).sort()).toEqual(['pdf', 'pptx']);
    expect(result.state.documents.every((document) => document.extractionStatus !== 'pending')).toBe(true);

    const pptxDocument = result.state.documents.find((document) => document.kind === 'pptx');
    expect(pptxDocument?.extractionStatus).toBe('ready');
    expect(pptxDocument?.chunkCount).toBeGreaterThan(0);
    expect(pptxDocument?.extractedTextFileName).toBeDefined();
    const extractedFilePath = path.join(getExtractedTextDir(userDataDir), pptxDocument?.extractedTextFileName ?? '');
    expect(fs.existsSync(extractedFilePath)).toBe(true);
  });

  it('publishes only valid drafts, carries generated topics into the bank view, and reports fallback coverage', () => {
    const validDraft = makeDraft({
      id: 'draft-valid',
      batchId: 'batch-1',
      topicId: 'attention_heads',
      topicLabel: 'Attention heads',
      selectionBucket: 'concept',
      promptType: 'multiple_choice',
      answerSchema: {
        kind: 'multiple_choice',
        options: ['A', 'B'],
        correctIndex: 1
      },
      citations: [makeCitation('doc-1', 'Lecture notes.pdf', 'Page 2')]
    });
    const invalidDraft = makeDraft({
      id: 'draft-invalid',
      batchId: 'batch-1',
      topicId: 'attention_heads',
      topicLabel: 'Attention heads',
      selectionBucket: 'concept',
      promptType: 'multiple_choice',
      answerSchema: {
        kind: 'multiple_choice',
        options: ['Only one'],
        correctIndex: 0
      },
      citations: [makeCitation('doc-2', 'Lecture notes.pdf', 'Page 3')],
      validationIssues: [{ field: 'answerSchema.options', message: 'Need at least two options.' }]
    });

    const initial = createDefaultQuestionBankState(new Date('2026-03-23T10:00:00.000Z'));
    const seeded = {
      ...initial,
      drafts: [validDraft, invalidDraft],
      batches: [makeBatch('batch-1', ['draft-valid', 'draft-invalid'])]
    };

    const published = publishDraftsInQuestionBank(seeded, ['draft-valid', 'draft-invalid'], new Date('2026-03-23T11:00:00.000Z'));
    const view = buildQuestionBankView(published.state);

    expect(published.publishedCount).toBe(1);
    expect(published.skippedCount).toBe(1);
    expect(published.state.publishedQuestions[0]?.topicId).toBe('attention_heads');
    expect(published.state.topics.some((topic) => topic.id === 'attention_heads' && topic.label === 'Attention heads')).toBe(true);
    expect(view.publishedSummary.coverage.requiresSeededFallback).toBe(true);
    expect(view.publishedSummary.byTopic[0]?.label).toBe('Attention heads');
  });

  it('uses generated questions when available in generated mode, falls back to seeded coverage, and scores new topics dynamically', () => {
    const bankState = createDefaultQuestionBankState(new Date('2026-03-23T10:00:00.000Z'));
    bankState.publishedQuestions = [
      {
        bankQuestionId: 'generated:q-backprop',
        origin: 'generated',
        createdAt: new Date('2026-03-23T10:10:00.000Z').toISOString(),
        updatedAt: new Date('2026-03-23T10:10:00.000Z').toISOString(),
        sourceBatchId: 'batch-1',
        title: 'Generated Backprop Check',
        source: 'Imported Lecture',
        topicId: 'attention_heads',
        topicLabel: 'Attention heads',
        difficulty: 'medium',
        promptType: 'structured',
        selectionBucket: 'backprop_auto',
        stem: 'Write the generated compact form.',
        workedSolution: 'alpha - y',
        answerSchema: {
          kind: 'structured',
          acceptableAnswers: ['alpha-y']
        },
        citations: [makeCitation('doc-1', 'Transformer notes.pdf', 'Slide 1')]
      }
    ];
    bankState.topics.push({
      id: 'attention_heads',
      label: 'Attention heads',
      origin: 'generated',
      createdAt: new Date('2026-03-23T10:10:00.000Z').toISOString()
    });

    const appState = createDefaultState(makeDate(8, 30));
    appState.settings.questionSourceMode = 'generated';
    const queued = queueDueSessions(appState, makeDate(9, 5), bankState).state;
    const activeSession = queued.sessions.find((session) => session.id === queued.activeSessionId);

    expect(activeSession).toBeDefined();
    if (!activeSession) {
      return;
    }

    const generatedQuestion = activeSession.questions.find((question) => question.origin === 'generated');
    expect(generatedQuestion).toBeDefined();
    expect(activeSession.questions.some((question) => question.origin === 'seeded')).toBe(true);
    if (!generatedQuestion || generatedQuestion.answerSchema.kind !== 'structured') {
      return;
    }

    const answered = submitAnswer(
      queued,
      activeSession.id,
      generatedQuestion.id,
      'wrong',
      makeDate(9, 6)
    ).state;

    expect(answered.weakTopicScores.attention_heads).toBe(2);
  });

  it('uses raw-file generation as the primary transport, repairs schema-only drafts, resolves citations, and persists running progress', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calctrainer-proxy-fallback-'));
    const userDataDir = path.join(tempDir, 'user-data');
    const { state, documentId } = makeReadyDocumentState(userDataDir);

    const previousEnv = {
      baseUrl: process.env.CALCTRAINER_AI_PROXY_BASE_URL,
      model: process.env.CALCTRAINER_AI_PROXY_MODEL,
      tool: process.env.CALCTRAINER_AI_PROXY_TOOL,
      parseMode: process.env.CALCTRAINER_AI_PROXY_PARSE_MODE
    };
    const originalFetch = global.fetch;

    process.env.CALCTRAINER_AI_PROXY_BASE_URL = 'http://proxy.test';
    process.env.CALCTRAINER_AI_PROXY_MODEL = 'gpt-test';
    delete process.env.CALCTRAINER_AI_PROXY_TOOL;
    delete process.env.CALCTRAINER_AI_PROXY_PARSE_MODE;

    let generationCallCount = 0;
    const persistedStates: Array<{ status: string; completed: number; repaired: number }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'http://proxy.test/api/tools') {
        return new Response(JSON.stringify({
          defaultTool: 'codex',
          tools: ['codex', 'gemini']
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (url === 'http://proxy.test/api/low-level') {
        const payload = JSON.parse(String(init?.body ?? '{}')) as { tool?: string; prompt?: string; files?: string[] };
        expect(payload.tool).toBe('codex');
        if (payload.prompt?.includes('Repair this CalcTrainer question draft')) {
          expect(payload.files).toBeUndefined();
          return new Response(JSON.stringify({
            response: JSON.stringify({
              title: 'Learning-rate update repaired',
              source: 'Lecture 4.pdf',
              topicId: 'learning_rate_and_optimizer',
              topicLabel: 'Learning rate and optimizers',
              difficulty: 'medium',
              promptType: 'numeric',
              selectionBucket: 'backprop_auto',
              stem: 'If w = 2 and the update subtracts 0.2, what is the new value?',
              workedSolution: '2 - 0.2 = 1.8',
              answerSchema: {
                kind: 'numeric',
                correctValue: 1.8,
                tolerance: 0.01
              },
              citations: [
                {
                  documentId,
                  documentName: 'Lecture 4.pdf',
                  locatorLabel: 'Page 1',
                  pageNumber: 1,
                  excerpt: 'Sigmoid derivative is sigma(x) * (1 - sigma(x)).'
                }
              ]
            })
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }

        expect(payload.prompt).toContain('Read the attached source document directly');
        expect(Array.isArray(payload.files)).toBe(true);
        expect(payload.files?.[0]).toBe(path.join(getManagedDocumentsDir(userDataDir), 'doc-generated.pdf'));
        generationCallCount += 1;
        const finalQuestionBatch = JSON.stringify({
          questions: Array.from({ length: 2 }, (_, index) => {
            const sequence = (generationCallCount - 1) * 2 + index + 1;
            if (sequence === 1) {
              return {
                title: 'Learning-rate update repaired',
                source: '',
                topicId: 'learning_rate_and_optimizer',
                topicLabel: 'Learning rate and optimizers',
                difficulty: 'medium',
                promptType: 'structured',
                selectionBucket: 'backprop_auto',
                stem: 'If w = 2 and the update subtracts 0.2, what is the new value?',
                workedSolution: '2 - 0.2 = 1.8',
                answerSchema: {
                  type: 'numeric',
                  value: '1.8',
                  tolerance: '0.01'
                },
                citations: [
                  {
                    documentId,
                    documentName: 'Lecture 4.pdf',
                    locatorLabel: 'Page 1',
                    pageNumber: 1,
                    excerpt: 'Sigmoid derivative is sigma(x) * (1 - sigma(x)).'
                  }
                ]
              };
            }

            return {
              title: `Derivative check ${sequence}`,
              source: 'Lecture 4.pdf',
              topicId: `sigmoid_derivative_${sequence}`,
              topicLabel: `Sigmoid derivative ${sequence}`,
              difficulty: 'medium',
              promptType: 'structured',
              selectionBucket: 'backprop_auto',
              stem: `State derivative pattern ${sequence}.`,
              workedSolution: 'sigma(x) * (1 - sigma(x))',
              answerSchema: {
                kind: 'structured',
                acceptedAnswers: ['sigma(x) * (1 - sigma(x))']
              },
              citations: [
                {
                  documentId,
                  documentName: 'Lecture 4.pdf',
                  locatorLabel: 'Page 1',
                  pageNumber: 1,
                  excerpt: 'Sigmoid derivative is sigma(x) * (1 - sigma(x)).'
                }
              ]
            };
          })
        });
        return new Response(JSON.stringify({
          response: [
            JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
            JSON.stringify({ type: 'turn.started' }),
            JSON.stringify({
              type: 'item.completed',
              item: {
                type: 'agent_message',
                text: finalQuestionBatch
              }
            })
          ].join('\n')
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    global.fetch = fetchMock as typeof global.fetch;

    try {
      const result = await generateDraftBatch(
        state,
        userDataDir,
        [documentId],
        new Date('2026-03-23T10:15:00.000Z'),
        {
          onStateChange: (nextState) => {
            const latestBatch = nextState.batches.find((batch) => batch.id.startsWith('batch-'));
            if (latestBatch) {
              persistedStates.push({
                status: latestBatch.status,
                completed: latestBatch.completedRequestCount,
                repaired: latestBatch.repairedDraftCount
              });
            }
          }
        }
      );

      expect(result.status).toBe('drafts_ready');
      expect(result.generatedCount).toBe(6);
      expect(result.state.drafts.some((draft) => draft.title === 'Learning-rate update repaired' && draft.validationIssues.length === 0)).toBe(true);
      expect(result.state.drafts.every((draft) => draft.citations[0]?.chunkId === 'page-1')).toBe(true);
      expect(result.state.batches[0]?.modelName).toBe('gpt-test via codex');
      expect(result.state.batches[0]?.generationMode).toBe('raw_files');
      expect(result.state.batches[0]?.completedRequestCount).toBe(3);
      expect(result.state.batches[0]?.totalRequestCount).toBe(3);
      expect(result.state.batches[0]?.repairedDraftCount).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(fetchMock.mock.calls[0]?.[0]).toBe('http://proxy.test/api/tools');
      expect(fetchMock.mock.calls.slice(1).every((call) => call[0] === 'http://proxy.test/api/low-level')).toBe(true);
      expect(persistedStates[0]).toEqual({ status: 'running', completed: 0, repaired: 0 });
      expect(persistedStates.some((stateEntry) => stateEntry.status === 'running' && stateEntry.completed === 3 && stateEntry.repaired === 1)).toBe(true);
      expect(persistedStates.at(-1)).toEqual({ status: 'drafts_ready', completed: 3, repaired: 1 });
    } finally {
      global.fetch = originalFetch;
      if (previousEnv.baseUrl === undefined) {
        delete process.env.CALCTRAINER_AI_PROXY_BASE_URL;
      } else {
        process.env.CALCTRAINER_AI_PROXY_BASE_URL = previousEnv.baseUrl;
      }
      if (previousEnv.model === undefined) {
        delete process.env.CALCTRAINER_AI_PROXY_MODEL;
      } else {
        process.env.CALCTRAINER_AI_PROXY_MODEL = previousEnv.model;
      }
      if (previousEnv.tool === undefined) {
        delete process.env.CALCTRAINER_AI_PROXY_TOOL;
      } else {
        process.env.CALCTRAINER_AI_PROXY_TOOL = previousEnv.tool;
      }
      if (previousEnv.parseMode === undefined) {
        delete process.env.CALCTRAINER_AI_PROXY_PARSE_MODE;
      } else {
        process.env.CALCTRAINER_AI_PROXY_PARSE_MODE = previousEnv.parseMode;
      }
    }
  });

  it('falls back to chunked responses when raw-file mode is unavailable', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calctrainer-proxy-responses-'));
    const userDataDir = path.join(tempDir, 'user-data');
    const { state, documentId } = makeReadyDocumentState(userDataDir);

    const previousEnv = {
      baseUrl: process.env.CALCTRAINER_AI_PROXY_BASE_URL,
      model: process.env.CALCTRAINER_AI_PROXY_MODEL,
      tool: process.env.CALCTRAINER_AI_PROXY_TOOL,
      parseMode: process.env.CALCTRAINER_AI_PROXY_PARSE_MODE
    };
    const originalFetch = global.fetch;

    process.env.CALCTRAINER_AI_PROXY_BASE_URL = 'http://proxy.test';
    process.env.CALCTRAINER_AI_PROXY_MODEL = 'gpt-test';
    delete process.env.CALCTRAINER_AI_PROXY_TOOL;
    delete process.env.CALCTRAINER_AI_PROXY_PARSE_MODE;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'http://proxy.test/api/tools') {
        return new Response('missing', {
          status: 404,
          headers: { 'content-type': 'text/plain' }
        });
      }
      if (url === 'http://proxy.test/responses') {
        const payload = JSON.parse(String(init?.body ?? '{}')) as { input?: Array<{ content?: Array<{ text?: string }> }> };
        expect(payload.input?.[1]?.content?.[0]?.text).toContain('Only use the provided chunk excerpts as source material.');
        return new Response(JSON.stringify({
          output_text: JSON.stringify({
            questions: Array.from({ length: 6 }, (_, index) => ({
              title: `Chunked derivative ${index + 1}`,
              source: 'Lecture 4.pdf',
              topicId: `chunked_topic_${index + 1}`,
              topicLabel: `Chunked topic ${index + 1}`,
              difficulty: 'medium',
              promptType: 'structured',
              selectionBucket: 'backprop_auto',
              stem: `State derivative ${index + 1}.`,
              workedSolution: 'sigma(x) * (1 - sigma(x))',
              answerSchema: {
                kind: 'structured',
                acceptableAnswers: ['sigma(x) * (1 - sigma(x))']
              },
              citations: [
                {
                  documentId,
                  documentName: 'Lecture 4.pdf',
                  chunkId: 'page-1',
                  locatorLabel: 'Page 1',
                  excerpt: 'Sigmoid derivative is sigma(x) * (1 - sigma(x)).'
                }
              ]
            }))
          })
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    global.fetch = fetchMock as typeof global.fetch;

    try {
      const result = await generateDraftBatch(state, userDataDir, [documentId], new Date('2026-03-23T10:15:00.000Z'));

      expect(result.status).toBe('drafts_ready');
      expect(result.generatedCount).toBe(6);
      expect(result.state.batches[0]?.generationMode).toBe('chunked_responses');
      expect(result.state.batches[0]?.completedRequestCount).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0]).toBe('http://proxy.test/api/tools');
      expect(fetchMock.mock.calls[1]?.[0]).toBe('http://proxy.test/responses');
    } finally {
      global.fetch = originalFetch;
      if (previousEnv.baseUrl === undefined) {
        delete process.env.CALCTRAINER_AI_PROXY_BASE_URL;
      } else {
        process.env.CALCTRAINER_AI_PROXY_BASE_URL = previousEnv.baseUrl;
      }
      if (previousEnv.model === undefined) {
        delete process.env.CALCTRAINER_AI_PROXY_MODEL;
      } else {
        process.env.CALCTRAINER_AI_PROXY_MODEL = previousEnv.model;
      }
      if (previousEnv.tool === undefined) {
        delete process.env.CALCTRAINER_AI_PROXY_TOOL;
      } else {
        process.env.CALCTRAINER_AI_PROXY_TOOL = previousEnv.tool;
      }
      if (previousEnv.parseMode === undefined) {
        delete process.env.CALCTRAINER_AI_PROXY_PARSE_MODE;
      } else {
        process.env.CALCTRAINER_AI_PROXY_PARSE_MODE = previousEnv.parseMode;
      }
    }
  });

  it('keeps successful drafts and marks the batch partial_error when a later raw-file request fails', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calctrainer-proxy-partial-'));
    const userDataDir = path.join(tempDir, 'user-data');
    const { state, documentId } = makeReadyDocumentState(userDataDir);

    const previousEnv = {
      baseUrl: process.env.CALCTRAINER_AI_PROXY_BASE_URL,
      model: process.env.CALCTRAINER_AI_PROXY_MODEL,
      tool: process.env.CALCTRAINER_AI_PROXY_TOOL,
      parseMode: process.env.CALCTRAINER_AI_PROXY_PARSE_MODE
    };
    const originalFetch = global.fetch;

    process.env.CALCTRAINER_AI_PROXY_BASE_URL = 'http://proxy.test';
    process.env.CALCTRAINER_AI_PROXY_TOOL = 'codex';
    delete process.env.CALCTRAINER_AI_PROXY_MODEL;
    delete process.env.CALCTRAINER_AI_PROXY_PARSE_MODE;

    let generationCallCount = 0;
    const persistedStatuses: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'http://proxy.test/api/low-level') {
        generationCallCount += 1;
        if (generationCallCount === 2) {
          return new Response('boom', {
            status: 500,
            headers: { 'content-type': 'text/plain' }
          });
        }
        const payload = JSON.parse(String(init?.body ?? '{}')) as { files?: string[] };
        expect(payload.files?.[0]).toBe(path.join(getManagedDocumentsDir(userDataDir), 'doc-generated.pdf'));
        return new Response(JSON.stringify({
          response: JSON.stringify({
            questions: Array.from({ length: 2 }, (_, index) => ({
              title: `Partial derivative ${index + 1}`,
              source: 'Lecture 4.pdf',
              topicId: `partial_topic_${index + 1}`,
              topicLabel: `Partial topic ${index + 1}`,
              difficulty: 'medium',
              promptType: 'structured',
              selectionBucket: 'backprop_auto',
              stem: `State derivative ${index + 1}.`,
              workedSolution: 'sigma(x) * (1 - sigma(x))',
              answerSchema: {
                kind: 'structured',
                acceptableAnswers: ['sigma(x) * (1 - sigma(x))']
              },
              citations: [
                {
                  documentId,
                  documentName: 'Lecture 4.pdf',
                  locatorLabel: 'Page 1',
                  pageNumber: 1,
                  excerpt: 'Sigmoid derivative is sigma(x) * (1 - sigma(x)).'
                }
              ]
            }))
          })
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    global.fetch = fetchMock as typeof global.fetch;

    try {
      const result = await generateDraftBatch(
        state,
        userDataDir,
        [documentId],
        new Date('2026-03-23T10:15:00.000Z'),
        {
          onStateChange: (nextState) => {
            const batch = nextState.batches.find((candidate) => candidate.id.startsWith('batch-'));
            if (batch) {
              persistedStatuses.push(batch.status);
            }
          }
        }
      );

      expect(result.status).toBe('partial_error');
      expect(result.generatedCount).toBe(2);
      expect(result.state.drafts).toHaveLength(2);
      expect(result.state.batches[0]?.generationMode).toBe('raw_files');
      expect(result.state.batches[0]?.completedRequestCount).toBe(1);
      expect(result.state.batches[0]?.totalRequestCount).toBe(3);
      expect(result.state.batches[0]?.errorMessage).toContain('500');
      expect(persistedStatuses[0]).toBe('running');
      expect(persistedStatuses.at(-1)).toBe('partial_error');
    } finally {
      global.fetch = originalFetch;
      if (previousEnv.baseUrl === undefined) {
        delete process.env.CALCTRAINER_AI_PROXY_BASE_URL;
      } else {
        process.env.CALCTRAINER_AI_PROXY_BASE_URL = previousEnv.baseUrl;
      }
      if (previousEnv.model === undefined) {
        delete process.env.CALCTRAINER_AI_PROXY_MODEL;
      } else {
        process.env.CALCTRAINER_AI_PROXY_MODEL = previousEnv.model;
      }
      if (previousEnv.tool === undefined) {
        delete process.env.CALCTRAINER_AI_PROXY_TOOL;
      } else {
        process.env.CALCTRAINER_AI_PROXY_TOOL = previousEnv.tool;
      }
      if (previousEnv.parseMode === undefined) {
        delete process.env.CALCTRAINER_AI_PROXY_PARSE_MODE;
      } else {
        process.env.CALCTRAINER_AI_PROXY_PARSE_MODE = previousEnv.parseMode;
      }
    }
  });
});
