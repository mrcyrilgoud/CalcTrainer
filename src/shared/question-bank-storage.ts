import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import JSZip from 'jszip';

import { SESSION_QUESTION_COUNT } from './settings';
import {
  AnswerSchema,
  Difficulty,
  DraftQuestionSourceRef,
  DraftQuestionFields,
  DraftValidationIssue,
  ExtractedTextChunk,
  GenerationBatchStatus,
  GeneratedQuestionDraft,
  ProxyParseMode,
  PromptType,
  PublishedBankQuestion,
  QuestionBankCoverage,
  QuestionBankDocument,
  QuestionBankState,
  QuestionGenerationMode,
  QuestionBankSummaryEntry,
  QuestionBankView,
  QuestionGenerationBatch,
  QuestionSourceRef,
  SEEDED_TOPIC_LABELS,
  SelectionBucket,
  TopicDefinition
} from './types';

const QUESTION_BANK_FILE_NAME = 'calc-trainer-question-bank.json';
const MANAGED_DOCUMENTS_DIR_NAME = 'calc-trainer-question-bank-documents';
const EXTRACTED_TEXT_DIR_NAME = 'calc-trainer-question-bank-extracted';
const REQUIRED_BUCKETS: SelectionBucket[] = ['derivation', 'backprop_auto', 'cnn_auto', 'concept'];
const MAX_PROMPT_CHARS = 18_000;
const LOW_LEVEL_MAX_PROMPT_CHARS = 9_000;
const LOW_LEVEL_MAX_CHUNK_ENTRIES = 12;
const LOW_LEVEL_MAX_DRAFTS_PER_REQUEST = 2;
const RAW_FILE_DRAFTS_PER_REQUEST = 2;
const RESPONSES_GENERATION_TIMEOUT_MS = 60_000;
const LOW_LEVEL_GENERATION_TIMEOUT_MS = 120_000;
const LOW_LEVEL_TOOL_CACHE = new Map<string, string>();

type ProxyConfig = {
  baseUrl: string;
  model?: string;
  tool: string;
  parseMode: ProxyParseMode;
  headers: Record<string, string>;
};

type ProxyStatusHint = 'raw_files' | 'chunked';

type ProxyQuestionPayload = {
  title?: unknown;
  source?: unknown;
  topicId?: unknown;
  topicLabel?: unknown;
  difficulty?: unknown;
  promptType?: unknown;
  selectionBucket?: unknown;
  stem?: unknown;
  hint?: unknown;
  workedSolution?: unknown;
  answerSchema?: unknown;
  citations?: unknown;
};

type GeneratedTransportResult = {
  questions: ProxyQuestionPayload[];
  modelName?: string;
  generationMode: QuestionGenerationMode;
};

type DraftProcessingResult = {
  draft: GeneratedQuestionDraft;
  repaired: boolean;
};

type GenerationPersistenceOptions = {
  onStateChange?: (state: QuestionBankState) => void | Promise<void>;
};

function getBackupFilePath(filePath: string): string {
  return `${filePath}.bak`;
}

function getCorruptFilePath(filePath: string): string {
  return `${filePath}.corrupt-${Date.now()}`;
}

function stableNow(now: Date = new Date()): string {
  return now.toISOString();
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function computeSha256(input: Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function readJsonFile<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFilePath, JSON.stringify(value, null, 2), 'utf8');
  try {
    fs.renameSync(tempFilePath, filePath);
    fs.copyFileSync(filePath, getBackupFilePath(filePath));
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.rmSync(tempFilePath, { force: true });
    }
  }
}

function archiveCorruptFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const corruptFilePath = getCorruptFilePath(filePath);
  try {
    fs.renameSync(filePath, corruptFilePath);
    console.error(`CalcTrainer archived unreadable question bank state at ${corruptFilePath}.`);
  } catch (error) {
    console.error(`CalcTrainer could not archive unreadable question bank state at ${filePath}.`, error);
  }
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeTopicId(input: unknown, fallback = 'generated_topic'): string {
  const normalized = normalizeString(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function isDifficulty(value: unknown): value is Difficulty {
  return value === 'medium' || value === 'hard';
}

function isPromptType(value: unknown): value is PromptType {
  return value === 'multiple_choice' || value === 'numeric' || value === 'structured' || value === 'derivation';
}

function isSelectionBucket(value: unknown): value is SelectionBucket {
  return value === 'derivation' || value === 'backprop_auto' || value === 'cnn_auto' || value === 'concept';
}

function normalizePromptTypeValue(value: unknown): PromptType | undefined {
  const normalized = normalizeString(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) {
    return undefined;
  }
  switch (normalized) {
    case 'multiple_choice':
    case 'multiplechoice':
    case 'multiple':
    case 'mcq':
      return 'multiple_choice';
    case 'numeric':
    case 'number':
    case 'numerical':
    case 'calculation':
      return 'numeric';
    case 'structured':
    case 'short_answer':
    case 'shortanswer':
    case 'free_response':
    case 'freeresponse':
    case 'open_response':
    case 'openanswer':
      return 'structured';
    case 'derivation':
    case 'show_work':
    case 'proof':
      return 'derivation';
    default:
      return undefined;
  }
}

function normalizeSelectionBucketValue(value: unknown): SelectionBucket | undefined {
  const normalized = normalizeString(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) {
    return undefined;
  }
  switch (normalized) {
    case 'derivation':
    case 'show_work':
      return 'derivation';
    case 'backprop_auto':
    case 'backprop':
    case 'backpropagation':
      return 'backprop_auto';
    case 'cnn_auto':
    case 'cnn':
    case 'convolution':
      return 'cnn_auto';
    case 'concept':
    case 'conceptual':
      return 'concept';
    default:
      return undefined;
  }
}

function normalizeNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildEmptyAnswerSchema(promptType: PromptType): AnswerSchema {
  switch (promptType) {
    case 'multiple_choice':
      return { kind: 'multiple_choice', options: ['Option A', 'Option B'], correctIndex: 0 };
    case 'numeric':
      return { kind: 'numeric', correctValue: 0, tolerance: 0 };
    case 'structured':
      return { kind: 'structured', acceptableAnswers: [''] };
    case 'derivation':
      return { kind: 'derivation', checklist: [''] };
  }
}

function isResolvedCitation(citation: DraftQuestionSourceRef): citation is QuestionSourceRef {
  return typeof citation.chunkId === 'string' && citation.chunkId.trim().length > 0;
}

function sanitizeCitation(raw: unknown, defaultDocument?: QuestionBankDocument): DraftQuestionSourceRef | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Partial<DraftQuestionSourceRef> & {
    page?: unknown;
    slide?: unknown;
    locator?: unknown;
  };
  const pageNumber = normalizeNumber(record.pageNumber ?? record.page);
  const slideNumber = normalizeNumber(record.slideNumber ?? record.slide);
  const documentId = normalizeString(record.documentId) || defaultDocument?.id || '';
  const documentName = normalizeString(record.documentName) || defaultDocument?.fileName || '';
  const chunkId = normalizeString(record.chunkId) || undefined;
  const locatorLabel = normalizeString(record.locatorLabel ?? record.locator)
    || (pageNumber !== undefined ? `Page ${pageNumber}` : slideNumber !== undefined ? `Slide ${slideNumber}` : '');
  const excerpt = normalizeString(record.excerpt);
  if (!documentId || !documentName || !locatorLabel || !excerpt) {
    return null;
  }

  return {
    documentId,
    documentName,
    chunkId,
    locatorLabel,
    excerpt,
    pageNumber,
    slideNumber
  };
}

function normalizeAnswerSchemaRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = { ...(raw as Record<string, unknown>) };
  if (record.kind === undefined) {
    const normalizedKind = normalizePromptTypeValue(record.type);
    if (normalizedKind) {
      record.kind = normalizedKind;
    }
  } else {
    const normalizedKind = normalizePromptTypeValue(record.kind);
    if (normalizedKind) {
      record.kind = normalizedKind;
    }
  }

  if (record.options === undefined && Array.isArray(record.choices)) {
    record.options = record.choices;
  }
  if (record.acceptableAnswers === undefined && Array.isArray(record.acceptedAnswers)) {
    record.acceptableAnswers = record.acceptedAnswers;
  }
  if (record.acceptableAnswers === undefined && Array.isArray(record.answers)) {
    record.acceptableAnswers = record.answers;
  }
  if (record.checklist === undefined && Array.isArray(record.steps)) {
    record.checklist = record.steps;
  }
  if (record.correctValue === undefined) {
    for (const alias of ['correct_answer', 'value', 'answer', 'expected']) {
      const candidate = normalizeNumber(record[alias]);
      if (candidate !== undefined) {
        record.correctValue = candidate;
        break;
      }
    }
  }

  if (!isPromptType(record.kind)) {
    if (Array.isArray(record.options)) {
      record.kind = 'multiple_choice';
    } else if (record.correctValue !== undefined || record.tolerance !== undefined) {
      record.kind = 'numeric';
    } else if (Array.isArray(record.acceptableAnswers)) {
      record.kind = 'structured';
    } else if (Array.isArray(record.checklist)) {
      record.kind = 'derivation';
    }
  }

  return record;
}

function inferPromptTypeFromAnswerSchema(record: Record<string, unknown> | null): PromptType | undefined {
  if (!record) {
    return undefined;
  }
  if (isPromptType(record.kind)) {
    return record.kind;
  }
  if (Array.isArray(record.options)) {
    return 'multiple_choice';
  }
  if (record.correctValue !== undefined || record.tolerance !== undefined) {
    return 'numeric';
  }
  if (Array.isArray(record.acceptableAnswers)) {
    return 'structured';
  }
  if (Array.isArray(record.checklist)) {
    return 'derivation';
  }
  return undefined;
}

type DraftValidationOptions = {
  defaultSource?: string;
  defaultDocument?: QuestionBankDocument;
};

type NormalizedDraftRecord = Omit<Partial<DraftQuestionFields>, 'answerSchema'> & {
  answerSchema?: Record<string, unknown>;
};

function normalizeDraftRecord(
  raw: Partial<DraftQuestionFields> | Record<string, unknown>,
  options: DraftValidationOptions = {}
): NormalizedDraftRecord {
  const record = raw as Record<string, unknown>;
  const answerSchema = normalizeAnswerSchemaRecord(record.answerSchema);
  const promptType = normalizePromptTypeValue(record.promptType) ?? inferPromptTypeFromAnswerSchema(answerSchema);

  if (answerSchema && !isPromptType(answerSchema.kind) && promptType) {
    answerSchema.kind = promptType;
  }

  return {
    title: normalizeString(record.title),
    source: normalizeString(record.source) || options.defaultSource,
    topicId: normalizeString(record.topicId),
    topicLabel: normalizeString(record.topicLabel),
    difficulty: isDifficulty(record.difficulty) ? record.difficulty : normalizeString(record.difficulty) === 'hard' ? 'hard' : undefined,
    promptType,
    selectionBucket: normalizeSelectionBucketValue(record.selectionBucket),
    stem: normalizeString(record.stem),
    hint: normalizeString(record.hint) || undefined,
    workedSolution: normalizeString(record.workedSolution),
    answerSchema: answerSchema ?? undefined,
    citations: Array.isArray(record.citations)
      ? record.citations
          .map((citation) => sanitizeCitation(citation, options.defaultDocument))
          .filter((value): value is DraftQuestionSourceRef => value !== null)
      : undefined
  };
}

function sanitizeAnswerSchema(raw: unknown, promptType: PromptType, issues: DraftValidationIssue[]): AnswerSchema {
  const record = normalizeAnswerSchemaRecord(raw);
  if (!record) {
    issues.push({ field: 'answerSchema', message: 'Answer schema is required.' });
    return buildEmptyAnswerSchema(promptType);
  }

  if (record.kind !== promptType) {
    issues.push({ field: 'promptType', message: 'Prompt type must match answer schema kind.' });
  }

  switch (promptType) {
    case 'multiple_choice': {
      const options = Array.isArray(record.options) ? record.options.map(normalizeString).filter(Boolean) : [];
      const correctIndex = Number(record.correctIndex);
      if (options.length < 2) {
        issues.push({ field: 'answerSchema.options', message: 'Multiple-choice questions need at least two options.' });
      }
      if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
        issues.push({ field: 'answerSchema.correctIndex', message: 'Correct index must reference one of the options.' });
      }
      return {
        kind: 'multiple_choice',
        options: options.length >= 2 ? options : ['Option A', 'Option B'],
        correctIndex: Number.isInteger(correctIndex) && correctIndex >= 0 ? correctIndex : 0
      };
    }
    case 'numeric': {
      const correctValue = Number(record.correctValue);
      const tolerance = Number(record.tolerance);
      if (!Number.isFinite(correctValue)) {
        issues.push({ field: 'answerSchema.correctValue', message: 'Numeric questions need a finite correct value.' });
      }
      if (!Number.isFinite(tolerance) || tolerance < 0) {
        issues.push({ field: 'answerSchema.tolerance', message: 'Tolerance must be zero or greater.' });
      }
      return {
        kind: 'numeric',
        correctValue: Number.isFinite(correctValue) ? correctValue : 0,
        tolerance: Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 0,
        unitLabel: normalizeString(record.unitLabel) || undefined
      };
    }
    case 'structured': {
      const acceptableAnswers = Array.isArray(record.acceptableAnswers)
        ? record.acceptableAnswers.map(normalizeString).filter(Boolean)
        : [];
      if (acceptableAnswers.length === 0) {
        issues.push({ field: 'answerSchema.acceptableAnswers', message: 'Structured questions need at least one accepted answer.' });
      }
      return {
        kind: 'structured',
        acceptableAnswers: acceptableAnswers.length > 0 ? acceptableAnswers : [''],
        placeholder: normalizeString(record.placeholder) || undefined
      };
    }
    case 'derivation': {
      const checklist = Array.isArray(record.checklist) ? record.checklist.map(normalizeString).filter(Boolean) : [];
      if (checklist.length === 0) {
        issues.push({ field: 'answerSchema.checklist', message: 'Derivation questions need at least one checklist item.' });
      }
      return {
        kind: 'derivation',
        checklist: checklist.length > 0 ? checklist : ['']
      };
    }
  }
}

export function validateDraftFields(
  raw: Partial<DraftQuestionFields> | Record<string, unknown>,
  options: DraftValidationOptions = {}
): { fields: DraftQuestionFields; issues: DraftValidationIssue[] } {
  const normalized = normalizeDraftRecord(raw, options);
  const issues: DraftValidationIssue[] = [];
  const promptType = isPromptType(normalized.promptType) ? normalized.promptType : 'structured';
  const selectionBucket = isSelectionBucket(normalized.selectionBucket) ? normalized.selectionBucket : 'concept';
  const difficulty = isDifficulty(normalized.difficulty) ? normalized.difficulty : 'medium';
  const topicLabel = normalizeString(normalized.topicLabel) || 'Generated topic';
  const topicId = sanitizeTopicId(normalized.topicId ?? topicLabel, 'generated_topic');
  const citations = Array.isArray(normalized.citations) ? normalized.citations : [];

  if (!normalizeString(normalized.title)) {
    issues.push({ field: 'title', message: 'Title is required.' });
  }
  if (!normalizeString(normalized.source)) {
    issues.push({ field: 'source', message: 'Source is required.' });
  }
  if (!normalizeString(normalized.stem)) {
    issues.push({ field: 'stem', message: 'Question prompt is required.' });
  }
  if (!normalizeString(normalized.workedSolution)) {
    issues.push({ field: 'workedSolution', message: 'Worked solution is required.' });
  }
  if (citations.length === 0) {
    issues.push({ field: 'citations', message: 'At least one citation is required.' });
  }
  if (promptType === 'derivation' && selectionBucket !== 'derivation') {
    issues.push({ field: 'selectionBucket', message: 'Derivation prompts must use the derivation bucket.' });
  }

  return {
    fields: {
      title: normalizeString(normalized.title),
      source: normalizeString(normalized.source),
      topicId,
      topicLabel,
      difficulty,
      promptType,
      selectionBucket,
      stem: normalizeString(normalized.stem),
      hint: normalizeString(normalized.hint) || undefined,
      workedSolution: normalizeString(normalized.workedSolution),
      answerSchema: sanitizeAnswerSchema(normalized.answerSchema, promptType, issues),
      citations
    },
    issues
  };
}

function hydrateDocument(raw: unknown): QuestionBankDocument | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Partial<QuestionBankDocument>;
  const id = normalizeString(record.id);
  const fileName = normalizeString(record.fileName);
  const kind = record.kind === 'pptx' ? 'pptx' : record.kind === 'pdf' ? 'pdf' : null;
  const checksumSha256 = normalizeString(record.checksumSha256);
  const storedFileName = normalizeString(record.storedFileName);
  if (!id || !fileName || !kind || !checksumSha256 || !storedFileName) {
    return null;
  }

  return {
    id,
    fileName,
    kind,
    checksumSha256,
    importedAt: normalizeString(record.importedAt) || stableNow(),
    storedFileName,
    extractedTextFileName: normalizeString(record.extractedTextFileName) || undefined,
    extractionStatus:
      record.extractionStatus === 'ready'
      || record.extractionStatus === 'failed'
      || record.extractionStatus === 'pending'
        ? record.extractionStatus
        : 'pending',
    extractionError: normalizeString(record.extractionError) || undefined,
    chunkCount: typeof record.chunkCount === 'number' ? record.chunkCount : 0
  };
}

function hydrateDraft(raw: unknown): GeneratedQuestionDraft | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Partial<GeneratedQuestionDraft>;
  const id = normalizeString(record.id);
  const batchId = normalizeString(record.batchId);
  if (!id || !batchId) {
    return null;
  }

  const validation = validateDraftFields(record);
  const persistedIssues = Array.isArray(record.validationIssues)
    ? record.validationIssues
        .filter((issue): issue is DraftValidationIssue => Boolean(issue && typeof issue === 'object'))
        .map((issue) => ({
          field: normalizeString(issue.field),
          message: normalizeString(issue.message)
        }))
        .filter((issue) => issue.field && issue.message)
    : [];

  return {
    id,
    batchId,
    createdAt: normalizeString(record.createdAt) || stableNow(),
    updatedAt: normalizeString(record.updatedAt) || stableNow(),
    rawIndex: typeof record.rawIndex === 'number' ? record.rawIndex : 0,
    ...validation.fields,
    validationIssues: validation.issues.length > 0 ? validation.issues : persistedIssues
  };
}

function hydratePublishedQuestion(raw: unknown): PublishedBankQuestion | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Partial<PublishedBankQuestion>;
  const bankQuestionId = normalizeString(record.bankQuestionId);
  const sourceBatchId = normalizeString(record.sourceBatchId);
  if (!bankQuestionId || !sourceBatchId) {
    return null;
  }

  const validation = validateDraftFields(record);
  const citations = validation.fields.citations.filter(isResolvedCitation);
  if (citations.length === 0) {
    return null;
  }
  return {
    bankQuestionId,
    origin: 'generated',
    createdAt: normalizeString(record.createdAt) || stableNow(),
    updatedAt: normalizeString(record.updatedAt) || stableNow(),
    sourceBatchId,
    archivedAt: normalizeString(record.archivedAt) || undefined,
    ...validation.fields,
    citations
  };
}

function hydrateBatch(raw: unknown): QuestionGenerationBatch | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Partial<QuestionGenerationBatch>;
  const id = normalizeString(record.id);
  if (!id) {
    return null;
  }

  const status: GenerationBatchStatus =
    record.status === 'running'
    || record.status === 'partial_error'
    || record.status === 'generation_failed'
    || record.status === 'drafts_ready'
      ? record.status
      : 'drafts_ready';
  const generationMode: QuestionGenerationMode =
    record.generationMode === 'raw_files'
    || record.generationMode === 'chunked_responses'
    || record.generationMode === 'chunked_low_level'
      ? record.generationMode
      : 'chunked_responses';

  return {
    id,
    createdAt: normalizeString(record.createdAt) || stableNow(),
    updatedAt: normalizeString(record.updatedAt) || stableNow(),
    documentIds: Array.isArray(record.documentIds) ? record.documentIds.map(normalizeString).filter(Boolean) : [],
    requestedDraftCount: typeof record.requestedDraftCount === 'number' ? record.requestedDraftCount : 0,
    draftIds: Array.isArray(record.draftIds) ? record.draftIds.map(normalizeString).filter(Boolean) : [],
    status,
    generationMode,
    completedRequestCount: typeof record.completedRequestCount === 'number' ? record.completedRequestCount : 0,
    totalRequestCount: typeof record.totalRequestCount === 'number' ? record.totalRequestCount : 0,
    repairedDraftCount: typeof record.repairedDraftCount === 'number' ? record.repairedDraftCount : 0,
    errorMessage: normalizeString(record.errorMessage) || undefined,
    modelName: normalizeString(record.modelName) || undefined
  };
}

function hydrateTopic(raw: unknown): TopicDefinition | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Partial<TopicDefinition>;
  const id = sanitizeTopicId(record.id);
  const label = normalizeString(record.label);
  const origin = record.origin === 'generated' ? 'generated' : 'seeded';
  if (!id || !label) {
    return null;
  }
  return {
    id,
    label,
    origin,
    createdAt: normalizeString(record.createdAt) || stableNow()
  };
}

export function createDefaultQuestionBankState(now: Date = new Date()): QuestionBankState {
  return {
    createdAt: stableNow(now),
    documents: [],
    batches: [],
    drafts: [],
    publishedQuestions: [],
    topics: Object.entries(SEEDED_TOPIC_LABELS).map(([id, label]) => ({
      id,
      label,
      origin: 'seeded',
      createdAt: stableNow(now)
    }))
  };
}

export function hydrateQuestionBankState(raw: unknown): QuestionBankState {
  const fallback = createDefaultQuestionBankState();
  if (!raw || typeof raw !== 'object') {
    return fallback;
  }

  const record = raw as Partial<QuestionBankState>;
  const topics = Array.isArray(record.topics)
    ? record.topics.map(hydrateTopic).filter((value): value is TopicDefinition => value !== null)
    : [];
  const seededTopics = Object.entries(SEEDED_TOPIC_LABELS).map(([id, label]) => ({
    id,
    label,
    origin: 'seeded' as const,
    createdAt: fallback.createdAt
  }));

  return {
    createdAt: normalizeString(record.createdAt) || fallback.createdAt,
    documents: Array.isArray(record.documents)
      ? record.documents.map(hydrateDocument).filter((value): value is QuestionBankDocument => value !== null)
      : [],
    batches: Array.isArray(record.batches)
      ? record.batches.map(hydrateBatch).filter((value): value is QuestionGenerationBatch => value !== null)
      : [],
    drafts: Array.isArray(record.drafts)
      ? record.drafts.map(hydrateDraft).filter((value): value is GeneratedQuestionDraft => value !== null)
      : [],
    publishedQuestions: Array.isArray(record.publishedQuestions)
      ? record.publishedQuestions.map(hydratePublishedQuestion).filter((value): value is PublishedBankQuestion => value !== null)
      : [],
    topics: mergeTopics(seededTopics, topics)
  };
}

function mergeTopics(...topicSets: TopicDefinition[][]): TopicDefinition[] {
  const seen = new Map<string, TopicDefinition>();
  for (const topicSet of topicSets) {
    for (const topic of topicSet) {
      if (!seen.has(topic.id)) {
        seen.set(topic.id, topic);
      }
    }
  }
  return [...seen.values()];
}

export function getQuestionBankFilePath(userDataDir: string): string {
  return path.join(userDataDir, QUESTION_BANK_FILE_NAME);
}

export function getManagedDocumentsDir(userDataDir: string): string {
  return path.join(userDataDir, MANAGED_DOCUMENTS_DIR_NAME);
}

export function getExtractedTextDir(userDataDir: string): string {
  return path.join(userDataDir, EXTRACTED_TEXT_DIR_NAME);
}

export function loadQuestionBankFile(filePath: string): QuestionBankState {
  try {
    const primary = readJsonFile<QuestionBankState>(filePath);
    if (primary) {
      return hydrateQuestionBankState(primary);
    }
  } catch (error) {
    console.error(`CalcTrainer could not read question bank file ${filePath}.`, error);
    archiveCorruptFile(filePath);
  }

  try {
    const backup = readJsonFile<QuestionBankState>(getBackupFilePath(filePath));
    if (backup) {
      return hydrateQuestionBankState(backup);
    }
  } catch (error) {
    console.error(`CalcTrainer could not read question bank backup ${getBackupFilePath(filePath)}.`, error);
  }

  return createDefaultQuestionBankState();
}

export function saveQuestionBankFile(filePath: string, state: QuestionBankState): void {
  writeJsonFile(filePath, state);
}

export function buildTopicLabelMap(questionBankState: QuestionBankState): Record<string, string> {
  const topicLabels: Record<string, string> = { ...SEEDED_TOPIC_LABELS };
  for (const topic of questionBankState.topics) {
    topicLabels[topic.id] = topic.label;
  }
  return topicLabels;
}

function createSummaryEntries(entries: Record<string, number>, labels: Record<string, string>): QuestionBankSummaryEntry[] {
  return Object.entries(entries)
    .map(([key, count]) => ({
      key,
      label: labels[key] ?? key,
      count
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

export function getQuestionBankCoverage(questionBankState: QuestionBankState): QuestionBankCoverage {
  const activeQuestions = questionBankState.publishedQuestions.filter((question) => !question.archivedAt);
  const availableBuckets = new Set(activeQuestions.map((question) => question.selectionBucket));
  const missingBuckets = REQUIRED_BUCKETS.filter((bucket) => !availableBuckets.has(bucket));
  const requiresSeededFallback = missingBuckets.length > 0 || activeQuestions.length < SESSION_QUESTION_COUNT;

  return {
    generatedQuestionCount: activeQuestions.length,
    missingBuckets,
    requiresSeededFallback
  };
}

function getProxyConfig(): ProxyConfig | null {
  const baseUrl = process.env.CALCTRAINER_AI_PROXY_BASE_URL?.trim();
  const model = process.env.CALCTRAINER_AI_PROXY_MODEL?.trim();
  const tool = process.env.CALCTRAINER_AI_PROXY_TOOL?.trim() || 'codex';
  const parseMode = process.env.CALCTRAINER_AI_PROXY_PARSE_MODE?.trim();
  if (!baseUrl) {
    return null;
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };
  const bearerToken = process.env.CALCTRAINER_AI_PROXY_AUTH_TOKEN?.trim();
  const apiKey = process.env.CALCTRAINER_AI_PROXY_API_KEY?.trim();
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  } else if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model: model || undefined,
    tool,
    parseMode: parseMode === 'raw_files' || parseMode === 'chunked' ? parseMode : 'auto',
    headers
  };
}

function getProxyStatusHint(proxyConfig: ProxyConfig): ProxyStatusHint {
  return proxyConfig.parseMode === 'chunked' ? 'chunked' : 'raw_files';
}

function getProxyStatusView(): QuestionBankView['proxyStatus'] {
  const proxyConfig = getProxyConfig();
  if (!proxyConfig) {
    return {
      configured: false,
      parseMode: 'auto',
      message: 'Proxy not configured. Set CALCTRAINER_AI_PROXY_BASE_URL to enable generation.'
    };
  }

  const statusHint = getProxyStatusHint(proxyConfig);
  return {
    configured: true,
    baseUrl: proxyConfig.baseUrl,
    model: proxyConfig.model ?? proxyConfig.tool,
    parseMode: proxyConfig.parseMode,
    message: proxyConfig.model
      ? `Proxy configured for ${proxyConfig.model}. ${statusHint === 'raw_files' ? 'LLM file parsing mode enabled.' : 'Chunk fallback mode enabled.'}`
      : `Proxy configured for ${proxyConfig.tool} via AI-CLI adapter. ${statusHint === 'raw_files' ? 'LLM file parsing mode enabled.' : 'Chunk fallback mode enabled.'}`
  };
}

export function buildQuestionBankView(questionBankState: QuestionBankState): QuestionBankView {
  const coverage = getQuestionBankCoverage(questionBankState);
  const bucketCounts: Record<string, number> = {};
  const topicCounts: Record<string, number> = {};
  let archivedCount = 0;

  for (const question of questionBankState.publishedQuestions) {
    if (question.archivedAt) {
      archivedCount += 1;
      continue;
    }
    bucketCounts[question.selectionBucket] = (bucketCounts[question.selectionBucket] ?? 0) + 1;
    topicCounts[question.topicId] = (topicCounts[question.topicId] ?? 0) + 1;
  }

  const topicLabels = buildTopicLabelMap(questionBankState);
  const activeQuestions = questionBankState.publishedQuestions.filter((question) => !question.archivedAt);

  return {
    documents: [...questionBankState.documents].sort((left, right) => right.importedAt.localeCompare(left.importedAt)),
    batches: [...questionBankState.batches].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    drafts: [...questionBankState.drafts].sort((left, right) => {
      if (left.batchId === right.batchId) {
        return left.rawIndex - right.rawIndex;
      }
      return right.createdAt.localeCompare(left.createdAt);
    }),
    publishedQuestions: [...questionBankState.publishedQuestions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    publishedSummary: {
      activeCount: activeQuestions.length,
      archivedCount,
      byBucket: createSummaryEntries(bucketCounts, {
        derivation: 'Derivation',
        backprop_auto: 'Backprop auto-graded',
        cnn_auto: 'CNN auto-graded',
        concept: 'Concept'
      }),
      byTopic: createSummaryEntries(topicCounts, topicLabels),
      coverage
    },
    proxyStatus: getProxyStatusView()
  };
}

async function loadPdfJs() {
  const dynamicImport = new Function('specifier', 'return import(specifier);') as (specifier: string) => Promise<{
    getDocument: (source: { data: Uint8Array; disableWorker: boolean }) => { promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getTextContent: () => Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>;
      }>;
    }> };
  }>;
  return dynamicImport('pdfjs-dist/legacy/build/pdf.mjs');
}

async function extractPdfChunks(fileBuffer: Buffer): Promise<ExtractedTextChunk[]> {
  const pdfjs = await loadPdfJs();
  const pdfDocument = await pdfjs.getDocument({
    data: new Uint8Array(fileBuffer),
    disableWorker: true
  }).promise;
  const chunks: ExtractedTextChunk[] = [];

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => {
        const str = typeof item.str === 'string' ? item.str : '';
        return item.hasEOL ? `${str}\n` : str;
      })
      .join(' ')
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim();

    if (!text) {
      continue;
    }

    chunks.push({
      id: `page-${pageNumber}`,
      order: pageNumber,
      text,
      locatorLabel: `Page ${pageNumber}`,
      pageNumber
    });
  }

  return chunks;
}

function decodeXmlText(buffer: Buffer): string {
  return buffer.toString('utf8');
}

function extractTextRuns(xmlText: string): string {
  const matches = [...xmlText.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)];
  return matches
    .map((match) =>
      match[1]!
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeZipPath(basePath: string, target: string): string {
  if (target.startsWith('/')) {
    return target.slice(1);
  }

  const parts = basePath.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '.' || segment === '') {
      continue;
    }
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join('/');
}

async function extractPptxChunks(fileBuffer: Buffer): Promise<ExtractedTextChunk[]> {
  const zip = await JSZip.loadAsync(fileBuffer);
  const presentationXml = zip.file('ppt/presentation.xml');
  const relationshipsXml = zip.file('ppt/_rels/presentation.xml.rels');
  if (!presentationXml || !relationshipsXml) {
    return [];
  }

  const slideIdMatches = [...(await presentationXml.async('string')).matchAll(/r:id="([^"]+)"/g)];
  const relText = await relationshipsXml.async('string');
  const relationMap = new Map<string, string>();
  for (const match of relText.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relationMap.set(match[1]!, normalizeZipPath('ppt/presentation.xml', match[2]!));
  }

  const chunks: ExtractedTextChunk[] = [];
  for (let index = 0; index < slideIdMatches.length; index += 1) {
    const relationId = slideIdMatches[index]?.[1];
    if (!relationId) {
      continue;
    }
    const slidePath = relationMap.get(relationId);
    if (!slidePath) {
      continue;
    }
    const slideFile = zip.file(slidePath);
    if (!slideFile) {
      continue;
    }
    const slideText = extractTextRuns(decodeXmlText(await slideFile.async('nodebuffer')));
    if (!slideText) {
      continue;
    }
    const slideNumber = index + 1;
    chunks.push({
      id: `slide-${slideNumber}`,
      order: slideNumber,
      text: slideText,
      locatorLabel: `Slide ${slideNumber}`,
      slideNumber
    });
  }

  return chunks;
}

async function extractChunksForDocument(kind: QuestionBankDocument['kind'], fileBuffer: Buffer): Promise<ExtractedTextChunk[]> {
  return kind === 'pdf' ? extractPdfChunks(fileBuffer) : extractPptxChunks(fileBuffer);
}

function getExtractedTextFilePath(userDataDir: string, fileName: string): string {
  return path.join(getExtractedTextDir(userDataDir), fileName);
}

function getManagedDocumentFilePath(userDataDir: string, fileName: string): string {
  return path.join(getManagedDocumentsDir(userDataDir), fileName);
}

async function saveExtractedChunks(userDataDir: string, documentId: string, chunks: ExtractedTextChunk[]): Promise<string> {
  const fileName = `${documentId}.json`;
  writeJsonFile(getExtractedTextFilePath(userDataDir, fileName), chunks);
  return fileName;
}

function loadExtractedChunks(userDataDir: string, document: QuestionBankDocument): ExtractedTextChunk[] {
  if (!document.extractedTextFileName) {
    return [];
  }
  const filePath = getExtractedTextFilePath(userDataDir, document.extractedTextFileName);
  const chunks = readJsonFile<ExtractedTextChunk[]>(filePath);
  if (!Array.isArray(chunks)) {
    return [];
  }
  return chunks
    .filter((chunk): chunk is ExtractedTextChunk => Boolean(chunk && typeof chunk === 'object' && normalizeString(chunk.id) && normalizeString(chunk.text)))
    .map((chunk) => ({
      id: normalizeString(chunk.id),
      order: typeof chunk.order === 'number' ? chunk.order : 0,
      text: normalizeString(chunk.text),
      locatorLabel: normalizeString(chunk.locatorLabel),
      pageNumber: typeof chunk.pageNumber === 'number' ? chunk.pageNumber : undefined,
      slideNumber: typeof chunk.slideNumber === 'number' ? chunk.slideNumber : undefined
    }))
    .sort((left, right) => left.order - right.order);
}

export async function importQuestionBankFiles(
  questionBankState: QuestionBankState,
  filePaths: string[],
  userDataDir: string,
  now: Date = new Date()
): Promise<{
  state: QuestionBankState;
  importedCount: number;
  duplicateFiles: string[];
  unsupportedFiles: string[];
  extractionFailures: string[];
}> {
  let nextState = questionBankState;
  let importedCount = 0;
  const duplicateFiles: string[] = [];
  const unsupportedFiles: string[] = [];
  const extractionFailures: string[] = [];

  fs.mkdirSync(getManagedDocumentsDir(userDataDir), { recursive: true });
  fs.mkdirSync(getExtractedTextDir(userDataDir), { recursive: true });

  for (const filePath of filePaths) {
    const extension = path.extname(filePath).toLowerCase();
    const kind = extension === '.pdf' ? 'pdf' : extension === '.pptx' ? 'pptx' : null;
    if (!kind) {
      unsupportedFiles.push(path.basename(filePath));
      continue;
    }

    const fileBuffer = fs.readFileSync(filePath);
    const checksumSha256 = computeSha256(fileBuffer);
    if (nextState.documents.some((document) => document.checksumSha256 === checksumSha256)) {
      duplicateFiles.push(path.basename(filePath));
      continue;
    }

    const documentId = createId('doc');
    const storedFileName = `${documentId}${extension}`;
    fs.copyFileSync(filePath, getManagedDocumentFilePath(userDataDir, storedFileName));

    let chunks: ExtractedTextChunk[] = [];
    let extractionStatus: QuestionBankDocument['extractionStatus'] = 'ready';
    let extractionError: string | undefined;
    let extractedTextFileName: string | undefined;

    try {
      chunks = await extractChunksForDocument(kind, fileBuffer);
      if (chunks.length === 0) {
        extractionStatus = 'failed';
        extractionError = 'No extractable text was found in this file.';
        extractionFailures.push(path.basename(filePath));
      } else {
        extractedTextFileName = await saveExtractedChunks(userDataDir, documentId, chunks);
      }
    } catch (error) {
      extractionStatus = 'failed';
      extractionError = error instanceof Error ? error.message : 'Extraction failed.';
      extractionFailures.push(path.basename(filePath));
    }

    const document: QuestionBankDocument = {
      id: documentId,
      fileName: path.basename(filePath),
      kind,
      checksumSha256,
      importedAt: stableNow(now),
      storedFileName,
      extractedTextFileName,
      extractionStatus,
      extractionError,
      chunkCount: chunks.length
    };

    nextState = {
      ...nextState,
      documents: [...nextState.documents, document]
    };
    importedCount += 1;
  }

  return {
    state: nextState,
    importedCount,
    duplicateFiles,
    unsupportedFiles,
    extractionFailures
  };
}

function buildCitationSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['documentId', 'documentName', 'locatorLabel', 'excerpt'],
    properties: {
      documentId: { type: 'string' },
      documentName: { type: 'string' },
      chunkId: { type: 'string' },
      locatorLabel: { type: 'string' },
      excerpt: { type: 'string' },
      pageNumber: { type: 'integer' },
      slideNumber: { type: 'integer' }
    }
  };
}

function buildQuestionVariantSchema(promptType: PromptType) {
  const baseProperties = {
    title: { type: 'string' },
    source: { type: 'string' },
    topicId: { type: 'string' },
    topicLabel: { type: 'string' },
    difficulty: { type: 'string', enum: ['medium', 'hard'] },
    promptType: { const: promptType },
    selectionBucket: promptType === 'derivation'
      ? { const: 'derivation' }
      : { type: 'string', enum: ['derivation', 'backprop_auto', 'cnn_auto', 'concept'] },
    stem: { type: 'string' },
    hint: { type: 'string' },
    workedSolution: { type: 'string' },
    citations: {
      type: 'array',
      minItems: 1,
      items: buildCitationSchema()
    }
  };

  switch (promptType) {
    case 'multiple_choice':
      return {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'source',
          'topicId',
          'topicLabel',
          'difficulty',
          'promptType',
          'selectionBucket',
          'stem',
          'workedSolution',
          'answerSchema',
          'citations'
        ],
        properties: {
          ...baseProperties,
          answerSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'options', 'correctIndex'],
            properties: {
              kind: { const: 'multiple_choice' },
              options: {
                type: 'array',
                minItems: 2,
                items: { type: 'string' }
              },
              correctIndex: { type: 'integer', minimum: 0 }
            }
          }
        }
      };
    case 'numeric':
      return {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'source',
          'topicId',
          'topicLabel',
          'difficulty',
          'promptType',
          'selectionBucket',
          'stem',
          'workedSolution',
          'answerSchema',
          'citations'
        ],
        properties: {
          ...baseProperties,
          answerSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'correctValue', 'tolerance'],
            properties: {
              kind: { const: 'numeric' },
              correctValue: { type: 'number' },
              tolerance: { type: 'number', minimum: 0 },
              unitLabel: { type: 'string' }
            }
          }
        }
      };
    case 'structured':
      return {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'source',
          'topicId',
          'topicLabel',
          'difficulty',
          'promptType',
          'selectionBucket',
          'stem',
          'workedSolution',
          'answerSchema',
          'citations'
        ],
        properties: {
          ...baseProperties,
          answerSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'acceptableAnswers'],
            properties: {
              kind: { const: 'structured' },
              acceptableAnswers: {
                type: 'array',
                minItems: 1,
                items: { type: 'string' }
              },
              placeholder: { type: 'string' }
            }
          }
        }
      };
    case 'derivation':
      return {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'source',
          'topicId',
          'topicLabel',
          'difficulty',
          'promptType',
          'selectionBucket',
          'stem',
          'workedSolution',
          'answerSchema',
          'citations'
        ],
        properties: {
          ...baseProperties,
          answerSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'checklist'],
            properties: {
              kind: { const: 'derivation' },
              checklist: {
                type: 'array',
                minItems: 1,
                items: { type: 'string' }
              }
            }
          }
        }
      };
  }
}

function buildSingleQuestionSchema() {
  return {
    oneOf: (['multiple_choice', 'numeric', 'structured', 'derivation'] as const).map((promptType) =>
      buildQuestionVariantSchema(promptType)
    )
  };
}

function buildGenerationSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        items: buildSingleQuestionSchema()
      }
    }
  };
}

function buildSingleQuestionResponseSchema() {
  return buildSingleQuestionSchema();
}

function buildPromptExamples(): string {
  const examples = [
    {
      title: 'Sigmoid derivative checkpoint',
      source: 'Lecture 4.pdf',
      topicId: 'sigmoid_tanh_relu_derivatives',
      topicLabel: 'Activation derivatives',
      difficulty: 'medium',
      promptType: 'multiple_choice',
      selectionBucket: 'concept',
      stem: 'Which expression gives the derivative of sigmoid(x)?',
      workedSolution: 'The sigmoid derivative is sigma(x) * (1 - sigma(x)).',
      answerSchema: {
        kind: 'multiple_choice',
        options: ['sigma(x)', 'sigma(x) * (1 - sigma(x))', '1 - sigma(x)', 'x * (1 - x)'],
        correctIndex: 1
      },
      citations: [
        {
          documentId: 'doc-example',
          documentName: 'Lecture 4.pdf',
          locatorLabel: 'Page 1',
          pageNumber: 1,
          excerpt: 'Sigmoid derivative is sigma(x) * (1 - sigma(x)).'
        }
      ]
    },
    {
      title: 'Learning-rate update value',
      source: 'Lecture 5.pdf',
      topicId: 'learning_rate_and_optimizer',
      topicLabel: 'Learning rate and optimizers',
      difficulty: 'medium',
      promptType: 'numeric',
      selectionBucket: 'backprop_auto',
      stem: 'If w = 2, gradient = 0.4, and eta = 0.5, what is the updated weight after one gradient descent step?',
      workedSolution: 'w_new = 2 - 0.5 * 0.4 = 1.8.',
      answerSchema: {
        kind: 'numeric',
        correctValue: 1.8,
        tolerance: 0.01
      },
      citations: [
        {
          documentId: 'doc-example',
          documentName: 'Lecture 5.pdf',
          locatorLabel: 'Page 2',
          pageNumber: 2,
          excerpt: 'Gradient descent updates weights by subtracting eta times the gradient.'
        }
      ]
    },
    {
      title: 'Backprop expression recall',
      source: 'Lecture 4.pdf',
      topicId: 'binary_bce_backprop',
      topicLabel: 'Binary BCE backprop',
      difficulty: 'hard',
      promptType: 'structured',
      selectionBucket: 'backprop_auto',
      stem: 'Write the output-layer gradient for a sigmoid neuron under binary cross-entropy.',
      workedSolution: 'The compact output-layer gradient is a - y.',
      answerSchema: {
        kind: 'structured',
        acceptableAnswers: ['a - y', 'alpha - y']
      },
      citations: [
        {
          documentId: 'doc-example',
          documentName: 'Lecture 4.pdf',
          locatorLabel: 'Page 3',
          pageNumber: 3,
          excerpt: 'For BCE with sigmoid, the output-layer derivative simplifies to a - y.'
        }
      ]
    },
    {
      title: 'Tanh chain-rule derivation',
      source: 'Lecture 4.pdf',
      topicId: 'sigmoid_tanh_relu_derivatives',
      topicLabel: 'Activation derivatives',
      difficulty: 'hard',
      promptType: 'derivation',
      selectionBucket: 'derivation',
      stem: 'Differentiate tanh(3x^2 - 2x).',
      workedSolution: 'Apply the chain rule: derivative is sech^2(3x^2 - 2x) * (6x - 2).',
      answerSchema: {
        kind: 'derivation',
        checklist: ['Differentiate the outer tanh term as sech^2(inner).', 'Differentiate the inner term 3x^2 - 2x as 6x - 2.', 'Multiply the outer and inner derivatives.']
      },
      citations: [
        {
          documentId: 'doc-example',
          documentName: 'Lecture 4.pdf',
          locatorLabel: 'Page 4',
          pageNumber: 4,
          excerpt: 'Use the chain rule: derivative of tanh(u) is sech^2(u) times u prime.'
        }
      ]
    }
  ];

  return examples
    .map((example) => JSON.stringify(example))
    .join('\n');
}

function buildSharedGenerationInstructions(requestedDraftCount: number, priorTitles: string[] = []): string[] {
  const instructions = [
    'Generate calculus practice questions for CalcTrainer.',
    `Return exactly ${requestedDraftCount} questions in JSON with a top-level "questions" array.`,
    'Return JSON only. Do not include markdown fences or commentary.',
    'Supported prompt types: multiple_choice, numeric, structured, derivation.',
    'Supported selection buckets: derivation, backprop_auto, cnn_auto, concept.',
    'Every question must include title, source, topicId, topicLabel, difficulty, promptType, selectionBucket, stem, optional hint, workedSolution, answerSchema, and citations.',
    'promptType must exactly match answerSchema.kind.',
    'Derivation prompts must use the derivation selection bucket.',
    'Do not leave answer arrays empty.',
    `JSON examples:\n${buildPromptExamples()}`,
    `JSON schema: ${JSON.stringify(buildGenerationSchema())}`
  ];

  if (priorTitles.length > 0) {
    instructions.splice(3, 0, `Do not repeat earlier generated titles: ${priorTitles.join(' | ')}`);
  }

  return instructions;
}

function buildChunkedGenerationPrompt(
  documents: QuestionBankDocument[],
  chunkEntries: Array<{ document: QuestionBankDocument; chunk: ExtractedTextChunk }>,
  requestedDraftCount: number,
  priorTitles: string[] = []
): string {
  const chunkSummaries = chunkEntries.map(({ document, chunk }) => ({
    documentId: document.id,
    documentName: document.fileName,
    chunkId: chunk.id,
    locatorLabel: chunk.locatorLabel,
    pageNumber: chunk.pageNumber,
    slideNumber: chunk.slideNumber,
    excerpt: chunk.text
  }));

  return [
    ...buildSharedGenerationInstructions(requestedDraftCount, priorTitles),
    'Only use the provided chunk excerpts as source material.',
    'For chunk-based generation, citations should include chunkId when it is available in the provided chunk metadata.',
    `Documents: ${JSON.stringify(documents.map((document) => ({ documentId: document.id, documentName: document.fileName, kind: document.kind })))}`,
    `Chunks: ${JSON.stringify(chunkSummaries)}`
  ].join('\n\n');
}

function buildRawFileGenerationPrompt(
  document: QuestionBankDocument,
  requestedDraftCount: number,
  priorTitles: string[] = []
): string {
  return [
    ...buildSharedGenerationInstructions(requestedDraftCount, priorTitles),
    'Read the attached source document directly and derive the questions from that file.',
    'Citations must include documentId, documentName, locatorLabel, excerpt, and pageNumber or slideNumber when known.',
    'Do not invent chunkId values. The app will resolve citations to chunk IDs after generation.',
    `Document metadata: ${JSON.stringify({ documentId: document.id, documentName: document.fileName, kind: document.kind })}`
  ].join('\n\n');
}

function buildRepairPrompt(
  promptType: PromptType,
  rawQuestion: ProxyQuestionPayload,
  issues: DraftValidationIssue[]
): string {
  return [
    'Repair this CalcTrainer question draft so it matches the exact required schema.',
    'Return only valid JSON for a single question object. Do not include markdown fences or commentary.',
    `Required promptType: ${promptType}`,
    'promptType must equal answerSchema.kind exactly.',
    'Derivation prompts must use the derivation selection bucket.',
    `Validation issues: ${JSON.stringify(issues)}`,
    `Required schema: ${JSON.stringify(buildQuestionVariantSchema(promptType))}`,
    `Current draft JSON: ${JSON.stringify(rawQuestion)}`
  ].join('\n\n');
}

function selectChunkEntriesForLowLevelPrompt(
  chunkEntries: Array<{ document: QuestionBankDocument; chunk: ExtractedTextChunk }>
): Array<{ document: QuestionBankDocument; chunk: ExtractedTextChunk }> {
  if (chunkEntries.length <= 1) {
    return chunkEntries;
  }

  const targetEntryCount = Math.min(LOW_LEVEL_MAX_CHUNK_ENTRIES, chunkEntries.length);
  const sampledIndexes = new Set<number>();
  for (let sampleIndex = 0; sampleIndex < targetEntryCount; sampleIndex += 1) {
    const entryIndex = Math.min(
      chunkEntries.length - 1,
      Math.floor((sampleIndex * chunkEntries.length) / targetEntryCount)
    );
    sampledIndexes.add(entryIndex);
  }

  const sampledEntries = [...sampledIndexes]
    .sort((left, right) => left - right)
    .map((entryIndex) => chunkEntries[entryIndex]!)
    .filter(Boolean);

  const limitedEntries: Array<{ document: QuestionBankDocument; chunk: ExtractedTextChunk }> = [];
  let usedChars = 0;
  for (const entry of sampledEntries) {
    const nextChunkLength = entry.chunk.text.length;
    if (limitedEntries.length > 0 && usedChars + nextChunkLength > LOW_LEVEL_MAX_PROMPT_CHARS) {
      continue;
    }
    limitedEntries.push(entry);
    usedChars += nextChunkLength;
  }

  return limitedEntries.length > 0 ? limitedEntries : [sampledEntries[0]!];
}

function extractOutputText(rawResponse: unknown): string {
  if (!rawResponse || typeof rawResponse !== 'object') {
    return '';
  }

  const record = rawResponse as Record<string, unknown>;
  if (typeof record.output_text === 'string') {
    return record.output_text;
  }
  if (typeof record.text === 'string') {
    return record.text;
  }

  const output = Array.isArray(record.output) ? record.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const content = Array.isArray((item as { content?: unknown }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) {
      if (!part || typeof part !== 'object') {
        continue;
      }
      const partRecord = part as Record<string, unknown>;
      const text = typeof partRecord.text === 'string' ? partRecord.text : typeof partRecord.output_text === 'string' ? partRecord.output_text : '';
      if (text) {
        chunks.push(text);
      }
    }
  }
  return chunks.join('\n');
}

function extractCodexAgentMessage(rawText: string): string {
  let latestMessage = '';
  for (const line of rawText.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
    try {
      const parsed = JSON.parse(line) as {
        type?: unknown;
        item?: {
          type?: unknown;
          text?: unknown;
        };
      };
      if (parsed.type === 'item.completed' && parsed.item?.type === 'agent_message' && typeof parsed.item.text === 'string') {
        latestMessage = parsed.item.text.trim();
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return latestMessage;
}

function extractBalancedJsonObject(rawText: string): string {
  const start = rawText.indexOf('{');
  if (start < 0) {
    return '';
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < rawText.length; index += 1) {
    const character = rawText[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString && character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (character === '{') {
      depth += 1;
      continue;
    }
    if (character !== '}') {
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return rawText.slice(start, index + 1);
    }
  }

  return '';
}

function parseJsonPayloadText(rawText: string): unknown {
  const trimmed = rawText.trim();
  const candidates = [trimmed];
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    candidates.push(fencedMatch[1].trim());
  }
  const balancedObject = extractBalancedJsonObject(trimmed);
  if (balancedObject) {
    candidates.push(balancedObject);
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next extraction strategy.
    }
  }

  throw new Error('Proxy response did not include valid JSON question data.');
}

function parseQuestionPayloadText(rawText: string): { questions?: ProxyQuestionPayload[] } {
  const parsed = parseJsonPayloadText(rawText);
  return parsed && typeof parsed === 'object' ? parsed as { questions?: ProxyQuestionPayload[] } : {};
}

function parseSingleQuestionPayloadText(rawText: string): ProxyQuestionPayload {
  const parsed = parseJsonPayloadText(rawText);
  if (parsed && typeof parsed === 'object') {
    const record = parsed as { questions?: unknown };
    if (Array.isArray(record.questions)) {
      const firstQuestion = record.questions.find((question): question is ProxyQuestionPayload => Boolean(question && typeof question === 'object'));
      if (firstQuestion) {
        return firstQuestion;
      }
    }
    return parsed as ProxyQuestionPayload;
  }
  throw new Error('Proxy response did not include a repaired question draft.');
}

class UnsupportedResponsesEndpointError extends Error {
  status: number;

  constructor(status: number) {
    super(`Responses endpoint unsupported with status ${status}.`);
    this.name = 'UnsupportedResponsesEndpointError';
    this.status = status;
  }
}

class UnsupportedLowLevelEndpointError extends Error {
  status: number;

  constructor(status: number) {
    super(`Low-level endpoint unsupported with status ${status}.`);
    this.name = 'UnsupportedLowLevelEndpointError';
    this.status = status;
  }
}

class UnsupportedRawFileTransportError extends Error {
  status: number;

  constructor(status: number) {
    super(`Raw-file transport unsupported with status ${status}.`);
    this.name = 'UnsupportedRawFileTransportError';
    this.status = status;
  }
}

async function generateQuestionPayloadsViaResponses(
  proxyConfig: ProxyConfig,
  documents: QuestionBankDocument[],
  chunkEntries: Array<{ document: QuestionBankDocument; chunk: ExtractedTextChunk }>,
  requestedDraftCount: number,
  signal: AbortSignal
): Promise<GeneratedTransportResult> {
  if (!proxyConfig.model) {
    throw new Error('Proxy model is not configured for the /responses transport.');
  }

  const response = await fetch(`${proxyConfig.baseUrl}/responses`, {
    method: 'POST',
    headers: proxyConfig.headers,
    body: JSON.stringify({
      model: proxyConfig.model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: 'You generate supported CalcTrainer question drafts.'
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: buildChunkedGenerationPrompt(documents, chunkEntries, requestedDraftCount)
            }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'calc_trainer_question_batch',
          schema: buildGenerationSchema()
        }
      }
    }),
    signal
  });

  if (!response.ok) {
    if (response.status === 404 || response.status === 405 || response.status === 501) {
      throw new UnsupportedResponsesEndpointError(response.status);
    }
    throw new Error(`Proxy request failed with status ${response.status}.`);
  }

  const body = await response.json();
  const outputText = extractOutputText(body);
  if (!outputText) {
    throw new Error('Proxy response did not include output text.');
  }
  const parsed = parseQuestionPayloadText(outputText);
  return {
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    modelName: proxyConfig.model,
    generationMode: 'chunked_responses'
  };
}

async function resolveLowLevelTool(proxyConfig: ProxyConfig, signal: AbortSignal): Promise<string> {
  const cachedTool = LOW_LEVEL_TOOL_CACHE.get(proxyConfig.baseUrl);
  if (cachedTool) {
    return cachedTool;
  }

  if (process.env.CALCTRAINER_AI_PROXY_TOOL?.trim()) {
    LOW_LEVEL_TOOL_CACHE.set(proxyConfig.baseUrl, proxyConfig.tool);
    return proxyConfig.tool;
  }

  try {
    const response = await fetch(`${proxyConfig.baseUrl}/api/tools`, {
      method: 'GET',
      headers: proxyConfig.headers,
      signal
    });
    if (!response.ok) {
      return proxyConfig.tool;
    }

    const body = await response.json() as { defaultTool?: unknown; tools?: unknown };
    if (typeof body.defaultTool === 'string' && body.defaultTool.trim()) {
      const resolvedTool = body.defaultTool.trim();
      LOW_LEVEL_TOOL_CACHE.set(proxyConfig.baseUrl, resolvedTool);
      return resolvedTool;
    }
    if (Array.isArray(body.tools)) {
      const fallbackTool = body.tools.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
      if (fallbackTool) {
        const resolvedTool = fallbackTool.trim();
        LOW_LEVEL_TOOL_CACHE.set(proxyConfig.baseUrl, resolvedTool);
        return resolvedTool;
      }
    }
  } catch {
    return proxyConfig.tool;
  }

  return proxyConfig.tool;
}

async function hasLowLevelCapability(proxyConfig: ProxyConfig, signal: AbortSignal): Promise<boolean> {
  if (proxyConfig.parseMode === 'raw_files' || Boolean(process.env.CALCTRAINER_AI_PROXY_TOOL?.trim())) {
    LOW_LEVEL_TOOL_CACHE.set(proxyConfig.baseUrl, proxyConfig.tool);
    return true;
  }

  try {
    const response = await fetch(`${proxyConfig.baseUrl}/api/tools`, {
      method: 'GET',
      headers: proxyConfig.headers,
      signal
    });
    if (!response.ok) {
      return false;
    }

    const body = await response.json() as { defaultTool?: unknown; tools?: unknown };
    if (typeof body.defaultTool === 'string' && body.defaultTool.trim()) {
      LOW_LEVEL_TOOL_CACHE.set(proxyConfig.baseUrl, body.defaultTool.trim());
    } else if (Array.isArray(body.tools)) {
      const fallbackTool = body.tools.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
      if (fallbackTool) {
        LOW_LEVEL_TOOL_CACHE.set(proxyConfig.baseUrl, fallbackTool.trim());
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function runLowLevelPrompt(
  proxyConfig: ProxyConfig,
  prompt: string,
  signal: AbortSignal,
  options: { files?: string[] } = {}
): Promise<{ outputText: string; modelName: string }> {
  const tool = await resolveLowLevelTool(proxyConfig, signal);
  const response = await fetch(`${proxyConfig.baseUrl}/api/low-level`, {
    method: 'POST',
    headers: proxyConfig.headers,
    body: JSON.stringify({
      tool,
      prompt,
      ...(options.files && options.files.length > 0 ? { files: options.files } : {})
    }),
    signal
  });

  if (!response.ok) {
    if (options.files && [400, 404, 405, 415, 422, 501].includes(response.status)) {
      throw new UnsupportedRawFileTransportError(response.status);
    }
    if (response.status === 404 || response.status === 405 || response.status === 501) {
      throw new UnsupportedLowLevelEndpointError(response.status);
    }
    throw new Error(`Proxy low-level request failed with status ${response.status}.`);
  }

  const body = await response.json() as { response?: unknown };
  const outputText = typeof body.response === 'string' ? body.response : extractOutputText(body);
  if (!outputText) {
    throw new Error('Proxy low-level response did not include question data.');
  }

  return {
    outputText: extractCodexAgentMessage(outputText) || outputText,
    modelName: proxyConfig.model ? `${proxyConfig.model} via ${tool}` : tool
  };
}

async function runWithAbortTimeout<T>(timeoutMs: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function generateQuestionPayloadsViaLowLevelRequest(
  proxyConfig: ProxyConfig,
  documents: QuestionBankDocument[],
  chunkEntries: Array<{ document: QuestionBankDocument; chunk: ExtractedTextChunk }>,
  requestedDraftCount: number,
  priorTitles: string[]
): Promise<GeneratedTransportResult> {
  const compactChunkEntries = selectChunkEntriesForLowLevelPrompt(chunkEntries);
  const response = await runWithAbortTimeout(LOW_LEVEL_GENERATION_TIMEOUT_MS, (signal) =>
    runLowLevelPrompt(
      proxyConfig,
      buildChunkedGenerationPrompt(documents, compactChunkEntries, requestedDraftCount, priorTitles),
      signal
    )
  );

  const parsed = parseQuestionPayloadText(response.outputText);
  const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  if (questions.length === 0) {
    throw new Error('Proxy low-level response did not include generated questions.');
  }

  return {
    questions,
    modelName: response.modelName,
    generationMode: 'chunked_low_level'
  };
}

async function generateQuestionPayloadsViaRawFilesRequest(
  proxyConfig: ProxyConfig,
  document: QuestionBankDocument,
  managedFilePath: string,
  requestedDraftCount: number,
  priorTitles: string[]
): Promise<GeneratedTransportResult> {
  const response = await runWithAbortTimeout(LOW_LEVEL_GENERATION_TIMEOUT_MS, (signal) =>
    runLowLevelPrompt(
      proxyConfig,
      buildRawFileGenerationPrompt(document, requestedDraftCount, priorTitles),
      signal,
      { files: [managedFilePath] }
    )
  );

  const parsed = parseQuestionPayloadText(response.outputText);
  const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  if (questions.length === 0) {
    throw new Error('Proxy low-level response did not include generated questions.');
  }

  return {
    questions,
    modelName: response.modelName,
    generationMode: 'raw_files'
  };
}

async function repairDraftViaResponses(
  proxyConfig: ProxyConfig,
  promptType: PromptType,
  rawQuestion: ProxyQuestionPayload,
  issues: DraftValidationIssue[]
): Promise<ProxyQuestionPayload> {
  if (!proxyConfig.model) {
    throw new Error('Proxy model is not configured for repair.');
  }

  const response = await runWithAbortTimeout(RESPONSES_GENERATION_TIMEOUT_MS, async (signal) =>
    fetch(`${proxyConfig.baseUrl}/responses`, {
      method: 'POST',
      headers: proxyConfig.headers,
      body: JSON.stringify({
        model: proxyConfig.model,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: buildRepairPrompt(promptType, rawQuestion, issues)
              }
            ]
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'calc_trainer_repaired_question',
            schema: buildSingleQuestionResponseSchema()
          }
        }
      }),
      signal
    })
  );

  if (!response.ok) {
    if (response.status === 404 || response.status === 405 || response.status === 501) {
      throw new UnsupportedResponsesEndpointError(response.status);
    }
    throw new Error(`Proxy repair request failed with status ${response.status}.`);
  }

  const body = await response.json();
  const outputText = extractOutputText(body);
  if (!outputText) {
    throw new Error('Proxy repair response did not include output text.');
  }
  return parseSingleQuestionPayloadText(outputText);
}

async function repairDraftViaLowLevel(
  proxyConfig: ProxyConfig,
  promptType: PromptType,
  rawQuestion: ProxyQuestionPayload,
  issues: DraftValidationIssue[]
): Promise<ProxyQuestionPayload> {
  const response = await runWithAbortTimeout(LOW_LEVEL_GENERATION_TIMEOUT_MS, (signal) =>
    runLowLevelPrompt(proxyConfig, buildRepairPrompt(promptType, rawQuestion, issues), signal)
  );
  return parseSingleQuestionPayloadText(response.outputText);
}

async function repairDraftViaProxy(
  proxyConfig: ProxyConfig,
  generationMode: QuestionGenerationMode,
  promptType: PromptType,
  rawQuestion: ProxyQuestionPayload,
  issues: DraftValidationIssue[]
): Promise<ProxyQuestionPayload> {
  if (generationMode === 'chunked_responses') {
    try {
      return await repairDraftViaResponses(proxyConfig, promptType, rawQuestion, issues);
    } catch (error) {
      if (!(error instanceof UnsupportedResponsesEndpointError)) {
        throw error;
      }
    }
  }

  return await repairDraftViaLowLevel(proxyConfig, promptType, rawQuestion, issues);
}

async function determineGenerationMode(proxyConfig: ProxyConfig): Promise<QuestionGenerationMode> {
  if (proxyConfig.parseMode === 'chunked') {
    return proxyConfig.model ? 'chunked_responses' : 'chunked_low_level';
  }
  if (proxyConfig.parseMode === 'raw_files') {
    return 'raw_files';
  }
  const hasLowLevel = await runWithAbortTimeout(10_000, (signal) => hasLowLevelCapability(proxyConfig, signal));
  if (hasLowLevel) {
    return 'raw_files';
  }
  return proxyConfig.model ? 'chunked_responses' : 'chunked_low_level';
}

function selectChunkEntriesForGeneration(
  documents: QuestionBankDocument[],
  userDataDir: string,
): Array<{ document: QuestionBankDocument; chunk: ExtractedTextChunk }> {
  const selectedEntries: Array<{ document: QuestionBankDocument; chunk: ExtractedTextChunk }> = [];
  let usedChars = 0;
  for (const document of documents) {
    const chunks = loadExtractedChunks(userDataDir, document);
    for (const chunk of chunks) {
      if (usedChars + chunk.text.length > MAX_PROMPT_CHARS) {
        return selectedEntries;
      }
      selectedEntries.push({ document, chunk });
      usedChars += chunk.text.length;
    }
  }
  return selectedEntries;
}

function isDocumentReadyForGeneration(document: QuestionBankDocument, userDataDir: string): boolean {
  if (document.extractionStatus !== 'ready' || !document.extractedTextFileName) {
    return false;
  }

  const managedFilePath = getManagedDocumentFilePath(userDataDir, document.storedFileName);
  const extractedFilePath = getExtractedTextFilePath(userDataDir, document.extractedTextFileName);
  return fs.existsSync(managedFilePath) && fs.existsSync(extractedFilePath) && loadExtractedChunks(userDataDir, document).length > 0;
}

function resolveCitationChunkId(citation: DraftQuestionSourceRef, chunks: ExtractedTextChunk[]): string | undefined {
  if (citation.chunkId && chunks.some((chunk) => chunk.id === citation.chunkId)) {
    return citation.chunkId;
  }

  if (citation.pageNumber !== undefined) {
    const pageMatch = chunks.find((chunk) => chunk.pageNumber === citation.pageNumber);
    if (pageMatch) {
      return pageMatch.id;
    }
  }

  if (citation.slideNumber !== undefined) {
    const slideMatch = chunks.find((chunk) => chunk.slideNumber === citation.slideNumber);
    if (slideMatch) {
      return slideMatch.id;
    }
  }

  const normalizedLocator = citation.locatorLabel.trim().toLowerCase();
  return chunks.find((chunk) => chunk.locatorLabel.trim().toLowerCase() === normalizedLocator)?.id;
}

function resolveDraftCitations(
  citations: DraftQuestionSourceRef[],
  documents: QuestionBankDocument[],
  userDataDir: string
): { citations: DraftQuestionSourceRef[]; issues: DraftValidationIssue[] } {
  const issues: DraftValidationIssue[] = [];
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  const chunkCache = new Map<string, ExtractedTextChunk[]>();
  const resolvedCitations: DraftQuestionSourceRef[] = [];

  for (const citation of citations) {
    const document = documentMap.get(citation.documentId);
    if (!document) {
      issues.push({ field: 'citations', message: `Citation document ${citation.documentId} is not available.` });
      continue;
    }
    if (!chunkCache.has(document.id)) {
      chunkCache.set(document.id, loadExtractedChunks(userDataDir, document));
    }
    const resolvedChunkId = resolveCitationChunkId(citation, chunkCache.get(document.id) ?? []);
    resolvedCitations.push({
      ...citation,
      documentName: citation.documentName || document.fileName,
      chunkId: resolvedChunkId
    });
    if (!resolvedChunkId) {
      issues.push({ field: 'citations', message: `Citation could not be resolved for ${document.fileName} at ${citation.locatorLabel}.` });
    }
  }

  return {
    citations: resolvedCitations,
    issues
  };
}

function isSchemaRepairableIssue(issue: DraftValidationIssue): boolean {
  return issue.field === 'promptType'
    || issue.field === 'selectionBucket'
    || issue.field === 'answerSchema'
    || issue.field.startsWith('answerSchema.');
}

function resolveRepairPromptType(rawQuestion: ProxyQuestionPayload, validation: { fields: DraftQuestionFields }): PromptType {
  const normalized = normalizeDraftRecord(rawQuestion);
  return isPromptType(normalized.promptType) ? normalized.promptType : validation.fields.promptType;
}

async function processGeneratedDraft(
  rawQuestion: ProxyQuestionPayload,
  batchId: string,
  rawIndex: number,
  generatedAt: string,
  selectedDocuments: QuestionBankDocument[],
  proxyConfig: ProxyConfig,
  generationMode: QuestionGenerationMode,
  userDataDir: string
): Promise<DraftProcessingResult> {
  const defaultDocument = selectedDocuments.length === 1 ? selectedDocuments[0] : undefined;
  let repaired = false;
  let repairIssues: DraftValidationIssue[] = [];
  let workingQuestion = rawQuestion;
  let validation = validateDraftFields(workingQuestion, {
    defaultSource: defaultDocument?.fileName,
    defaultDocument
  });

  if (validation.issues.length > 0 && validation.issues.every(isSchemaRepairableIssue)) {
    try {
      workingQuestion = await repairDraftViaProxy(
        proxyConfig,
        generationMode,
        resolveRepairPromptType(workingQuestion, validation),
        workingQuestion,
        validation.issues
      );
      validation = validateDraftFields(workingQuestion, {
        defaultSource: defaultDocument?.fileName,
        defaultDocument
      });
      repaired = true;
    } catch (error) {
      repairIssues = [
        {
          field: 'repair',
          message: error instanceof Error ? `Automatic schema repair failed: ${error.message}` : 'Automatic schema repair failed.'
        }
      ];
    }
  }

  const citationResolution = resolveDraftCitations(validation.fields.citations, selectedDocuments, userDataDir);
  return {
    draft: {
      id: createId('draft'),
      batchId,
      createdAt: generatedAt,
      updatedAt: generatedAt,
      rawIndex,
      ...validation.fields,
      citations: citationResolution.citations,
      validationIssues: [...validation.issues, ...citationResolution.issues, ...repairIssues]
    },
    repaired
  };
}

function replaceBatch(batches: QuestionGenerationBatch[], updatedBatch: QuestionGenerationBatch): QuestionGenerationBatch[] {
  return [updatedBatch, ...batches.filter((batch) => batch.id !== updatedBatch.id)];
}

async function persistIntermediateQuestionBankState(
  state: QuestionBankState,
  options: GenerationPersistenceOptions = {}
): Promise<void> {
  await options.onStateChange?.(state);
}

function buildRawFileRequestPlan(
  documents: QuestionBankDocument[],
  requestedDraftCount: number
): Array<{ document: QuestionBankDocument; requestedDraftCount: number }> {
  const requests: Array<{ document: QuestionBankDocument; requestedDraftCount: number }> = [];
  let remaining = requestedDraftCount;
  while (remaining > 0) {
    for (const document of documents) {
      if (remaining <= 0) {
        break;
      }
      const requestDraftCount = Math.min(RAW_FILE_DRAFTS_PER_REQUEST, remaining);
      requests.push({ document, requestedDraftCount: requestDraftCount });
      remaining -= requestDraftCount;
    }
  }
  return requests;
}

function buildChunkedLowLevelRequestPlan(requestedDraftCount: number): number[] {
  const requests: number[] = [];
  let remaining = requestedDraftCount;
  while (remaining > 0) {
    const requestDraftCount = Math.min(LOW_LEVEL_MAX_DRAFTS_PER_REQUEST, remaining);
    requests.push(requestDraftCount);
    remaining -= requestDraftCount;
  }
  return requests;
}

export async function generateDraftBatch(
  questionBankState: QuestionBankState,
  userDataDir: string,
  documentIds: string[],
  now: Date = new Date(),
  options: GenerationPersistenceOptions = {}
): Promise<{ state: QuestionBankState; batchId: string; generatedCount: number; status: GenerationBatchStatus; message?: string }> {
  const proxyConfig = getProxyConfig();
  if (!proxyConfig) {
    return {
      state: questionBankState,
      batchId: '',
      generatedCount: 0,
      status: 'generation_failed',
      message: 'Proxy is not configured.'
    };
  }

  const selectedDocuments = questionBankState.documents.filter(
    (document) => documentIds.includes(document.id) && isDocumentReadyForGeneration(document, userDataDir)
  );
  if (selectedDocuments.length === 0) {
    return {
      state: questionBankState,
      batchId: '',
      generatedCount: 0,
      status: 'generation_failed',
      message: 'Select at least one ready document before generating draft questions.'
    };
  }

  const requestedDraftCount = Math.min(18, 6 * selectedDocuments.length);
  const chunkEntries = selectChunkEntriesForGeneration(selectedDocuments, userDataDir);
  if (chunkEntries.length === 0) {
    return {
      state: questionBankState,
      batchId: '',
      generatedCount: 0,
      status: 'generation_failed',
      message: 'No extracted text is available for the selected documents.'
    };
  }

  const batchId = createId('batch');
  const batchCreatedAt = stableNow(now);
  let generationMode: QuestionGenerationMode;
  try {
    generationMode = await determineGenerationMode(proxyConfig);
  } catch {
    generationMode = proxyConfig.model ? 'chunked_responses' : 'chunked_low_level';
  }

  const totalRequestCount = generationMode === 'raw_files'
    ? buildRawFileRequestPlan(selectedDocuments, requestedDraftCount).length
    : generationMode === 'chunked_low_level'
      ? buildChunkedLowLevelRequestPlan(requestedDraftCount).length
      : 1;

  let currentBatch: QuestionGenerationBatch = {
    id: batchId,
    createdAt: batchCreatedAt,
    updatedAt: batchCreatedAt,
    documentIds: selectedDocuments.map((document) => document.id),
    requestedDraftCount,
    draftIds: [],
    status: 'running',
    generationMode,
    completedRequestCount: 0,
    totalRequestCount,
    repairedDraftCount: 0
  };

  let nextState: QuestionBankState = {
    ...questionBankState,
    batches: replaceBatch(questionBankState.batches, currentBatch)
  };
  await persistIntermediateQuestionBankState(nextState, options);

  const appendDrafts = async (drafts: GeneratedQuestionDraft[], modelName?: string, repairedDraftCount = 0): Promise<void> => {
    currentBatch = {
      ...currentBatch,
      updatedAt: stableNow(),
      draftIds: [...currentBatch.draftIds, ...drafts.map((draft) => draft.id)],
      completedRequestCount: currentBatch.completedRequestCount + 1,
      repairedDraftCount: currentBatch.repairedDraftCount + repairedDraftCount,
      modelName: modelName ?? currentBatch.modelName,
      status: 'running'
    };
    nextState = {
      ...nextState,
      drafts: [...drafts, ...nextState.drafts],
      batches: replaceBatch(nextState.batches, currentBatch)
    };
    await persistIntermediateQuestionBankState(nextState, options);
  };

  try {
    if (generationMode === 'raw_files') {
      const requestPlan = buildRawFileRequestPlan(selectedDocuments, requestedDraftCount);
      const priorTitles: string[] = [];
      let draftIndex = 0;

      for (const request of requestPlan) {
        const managedFilePath = getManagedDocumentFilePath(userDataDir, request.document.storedFileName);
        const generated = await generateQuestionPayloadsViaRawFilesRequest(
          proxyConfig,
          request.document,
          managedFilePath,
          request.requestedDraftCount,
          priorTitles
        );

        const processedDrafts: DraftProcessingResult[] = [];
        for (const rawQuestion of generated.questions.slice(0, request.requestedDraftCount)) {
          processedDrafts.push(await processGeneratedDraft(
            rawQuestion,
            batchId,
            draftIndex,
            batchCreatedAt,
            selectedDocuments,
            proxyConfig,
            generationMode,
            userDataDir
          ));
          draftIndex += 1;
          const title = normalizeString(rawQuestion.title);
          if (title) {
            priorTitles.push(title);
          }
        }

        await appendDrafts(
          processedDrafts.map((result) => result.draft),
          generated.modelName,
          processedDrafts.filter((result) => result.repaired).length
        );
      }
    } else if (generationMode === 'chunked_responses') {
      const generated = await runWithAbortTimeout(RESPONSES_GENERATION_TIMEOUT_MS, (signal) =>
        generateQuestionPayloadsViaResponses(proxyConfig, selectedDocuments, chunkEntries, requestedDraftCount, signal)
      );

      const processedDrafts: DraftProcessingResult[] = [];
      for (let index = 0; index < generated.questions.length; index += 1) {
        processedDrafts.push(await processGeneratedDraft(
          generated.questions[index] ?? {},
          batchId,
          index,
          batchCreatedAt,
          selectedDocuments,
          proxyConfig,
          generationMode,
          userDataDir
        ));
      }

      await appendDrafts(
        processedDrafts.map((result) => result.draft),
        generated.modelName,
        processedDrafts.filter((result) => result.repaired).length
      );
    } else {
      const requestPlan = buildChunkedLowLevelRequestPlan(requestedDraftCount);
      const priorTitles: string[] = [];
      let draftIndex = 0;

      for (const requestDraftCount of requestPlan) {
        const generated = await generateQuestionPayloadsViaLowLevelRequest(
          proxyConfig,
          selectedDocuments,
          chunkEntries,
          requestDraftCount,
          priorTitles
        );

        const processedDrafts: DraftProcessingResult[] = [];
        for (const rawQuestion of generated.questions.slice(0, requestDraftCount)) {
          processedDrafts.push(await processGeneratedDraft(
            rawQuestion,
            batchId,
            draftIndex,
            batchCreatedAt,
            selectedDocuments,
            proxyConfig,
            generationMode,
            userDataDir
          ));
          draftIndex += 1;
          const title = normalizeString(rawQuestion.title);
          if (title) {
            priorTitles.push(title);
          }
        }

        await appendDrafts(
          processedDrafts.map((result) => result.draft),
          generated.modelName,
          processedDrafts.filter((result) => result.repaired).length
        );
      }
    }
  } catch (error) {
    const hasGeneratedDrafts = currentBatch.draftIds.length > 0;
    currentBatch = {
      ...currentBatch,
      updatedAt: stableNow(),
      status: hasGeneratedDrafts ? 'partial_error' : 'generation_failed',
      errorMessage: error instanceof Error ? error.message : 'Generation failed.'
    };
    nextState = {
      ...nextState,
      batches: replaceBatch(nextState.batches, currentBatch)
    };
    await persistIntermediateQuestionBankState(nextState, options);
    return {
      state: nextState,
      batchId,
      generatedCount: currentBatch.draftIds.length,
      status: currentBatch.status,
      message: currentBatch.errorMessage
    };
  }

  const batchDrafts = nextState.drafts.filter((draft) => draft.batchId === batchId);
  currentBatch = {
    ...currentBatch,
    updatedAt: stableNow(),
    status: batchDrafts.some((draft) => draft.validationIssues.length > 0) ? 'partial_error' : 'drafts_ready',
    errorMessage: undefined
  };
  nextState = {
    ...nextState,
    batches: replaceBatch(nextState.batches, currentBatch)
  };
  await persistIntermediateQuestionBankState(nextState, options);

  return {
    state: nextState,
    batchId,
    generatedCount: currentBatch.draftIds.length,
    status: currentBatch.status
  };
}

export function updateDraftInQuestionBank(
  questionBankState: QuestionBankState,
  draftId: string,
  rawFields: Partial<DraftQuestionFields>,
  userDataDir: string,
  now: Date = new Date()
): { state: QuestionBankState; updated: boolean; issues: DraftValidationIssue[] } {
  const draft = questionBankState.drafts.find((candidate) => candidate.id === draftId);
  if (!draft) {
    return {
      state: questionBankState,
      updated: false,
      issues: [{ field: 'draft', message: 'Draft not found.' }]
    };
  }

  const validation = validateDraftFields({
    ...draft,
    ...rawFields
  });
  const relatedDocuments = questionBankState.documents.filter((document) =>
    validation.fields.citations.some((citation) => citation.documentId === document.id)
  );
  const citationResolution = resolveDraftCitations(validation.fields.citations, relatedDocuments, userDataDir);
  const issues = [...validation.issues, ...citationResolution.issues];

  const nextDrafts = questionBankState.drafts.map((candidate) =>
    candidate.id === draftId
      ? {
          ...candidate,
          ...validation.fields,
          citations: citationResolution.citations,
          validationIssues: issues,
          updatedAt: stableNow(now)
        }
      : candidate
  );

  return {
    state: {
      ...questionBankState,
      drafts: nextDrafts
    },
    updated: true,
    issues
  };
}

export function deleteDraftFromQuestionBank(
  questionBankState: QuestionBankState,
  payload: { draftId?: string; batchId?: string },
  now: Date = new Date()
): { state: QuestionBankState; deletedCount: number } {
  const draftIdsToDelete = new Set(
    payload.batchId
      ? questionBankState.drafts.filter((draft) => draft.batchId === payload.batchId).map((draft) => draft.id)
      : payload.draftId
        ? [payload.draftId]
        : []
  );
  if (draftIdsToDelete.size === 0) {
    return {
      state: questionBankState,
      deletedCount: 0
    };
  }

  const remainingDrafts = questionBankState.drafts.filter((draft) => !draftIdsToDelete.has(draft.id));
  const nowIso = stableNow(now);
  const nextBatches = questionBankState.batches.map((batch) => ({
    ...batch,
    draftIds: batch.draftIds.filter((draftId) => !draftIdsToDelete.has(draftId)),
    updatedAt: draftIdsToDelete.size > 0 ? nowIso : batch.updatedAt
  }));

  return {
    state: {
      ...questionBankState,
      drafts: remainingDrafts,
      batches: nextBatches
    },
    deletedCount: draftIdsToDelete.size
  };
}

export function publishDraftsInQuestionBank(
  questionBankState: QuestionBankState,
  draftIds: string[],
  now: Date = new Date()
): { state: QuestionBankState; publishedCount: number; skippedCount: number } {
  const draftIdSet = new Set(draftIds);
  const draftsToPublish = questionBankState.drafts.filter((draft) => draftIdSet.has(draft.id));
  const validDrafts = draftsToPublish.filter((draft) => draft.validationIssues.length === 0 && draft.citations.every(isResolvedCitation));
  const publishedQuestions: PublishedBankQuestion[] = validDrafts.map((draft) => ({
    bankQuestionId: `generated:${draft.id}`,
    origin: 'generated',
    createdAt: stableNow(now),
    updatedAt: stableNow(now),
    sourceBatchId: draft.batchId,
    title: draft.title,
    source: draft.source,
    topicId: draft.topicId,
    topicLabel: draft.topicLabel,
    difficulty: draft.difficulty,
    promptType: draft.promptType,
    selectionBucket: draft.selectionBucket,
    stem: draft.stem,
    hint: draft.hint,
    workedSolution: draft.workedSolution,
    answerSchema: draft.answerSchema,
    citations: draft.citations.filter(isResolvedCitation)
  }));

  const publishedDraftIds = new Set(validDrafts.map((draft) => draft.id));
  const nextDrafts = questionBankState.drafts.filter((draft) => !publishedDraftIds.has(draft.id));
  const nowIso = stableNow(now);
  const nextBatches = questionBankState.batches.map((batch) => ({
    ...batch,
    draftIds: batch.draftIds.filter((draftId) => !publishedDraftIds.has(draftId)),
    updatedAt: batch.draftIds.some((draftId) => publishedDraftIds.has(draftId)) ? nowIso : batch.updatedAt
  }));
  const generatedTopics = validDrafts.map((draft) => ({
    id: draft.topicId,
    label: draft.topicLabel,
    origin: 'generated' as const,
    createdAt: nowIso
  }));

  return {
    state: {
      ...questionBankState,
      drafts: nextDrafts,
      batches: nextBatches,
      publishedQuestions: [...publishedQuestions, ...questionBankState.publishedQuestions],
      topics: mergeTopics(questionBankState.topics, generatedTopics)
    },
    publishedCount: validDrafts.length,
    skippedCount: draftsToPublish.length - validDrafts.length
  };
}

export function archivePublishedQuestions(
  questionBankState: QuestionBankState,
  questionIds: string[],
  now: Date = new Date()
): { state: QuestionBankState; archivedCount: number } {
  const questionIdSet = new Set(questionIds);
  let archivedCount = 0;
  const nowIso = stableNow(now);
  const nextPublished = questionBankState.publishedQuestions.map((question) => {
    if (!questionIdSet.has(question.bankQuestionId) || question.archivedAt) {
      return question;
    }
    archivedCount += 1;
    return {
      ...question,
      archivedAt: nowIso,
      updatedAt: nowIso
    };
  });

  return {
    state: {
      ...questionBankState,
      publishedQuestions: nextPublished
    },
    archivedCount
  };
}
