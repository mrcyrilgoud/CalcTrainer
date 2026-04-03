export const TOPIC_TAGS = [
  'binary_bce_backprop',
  'sigmoid_tanh_relu_derivatives',
  'multiclass_softmax_cross_entropy',
  'learning_rate_and_optimizer',
  'conv_output_size',
  'padding_stride_pooling',
  'conv_parameter_count'
] as const;

export const SEEDED_TOPIC_LABELS: Record<(typeof TOPIC_TAGS)[number], string> = {
  binary_bce_backprop: 'Binary BCE backprop',
  sigmoid_tanh_relu_derivatives: 'Activation derivatives',
  multiclass_softmax_cross_entropy: 'Softmax backprop',
  learning_rate_and_optimizer: 'Learning rate and optimizers',
  conv_output_size: 'Convolution output size',
  padding_stride_pooling: 'Padding, stride, and pooling',
  conv_parameter_count: 'Convolution parameter count'
};

export type TopicTag = string;
export type Difficulty = 'medium' | 'hard';
export type PromptType = 'multiple_choice' | 'numeric' | 'structured' | 'derivation';
export type EnforcementMode = 'must_finish_session';
export type EnforcementStyle = 'strict' | 'lighter';
export type QuestionSourceMode = 'seeded' | 'generated' | 'mixed';
export type SessionStatus = 'pending' | 'active' | 'completed';
export type SelfCheckRating = 'needs_work' | 'solid';
export type SelectionBucket = 'derivation' | 'backprop_auto' | 'cnn_auto' | 'concept';
export type BankQuestionOrigin = 'seeded' | 'generated';
export type DocumentKind = 'pdf' | 'pptx';
export type DocumentExtractionStatus = 'pending' | 'ready' | 'failed';
export type GenerationBatchStatus = 'running' | 'drafts_ready' | 'partial_error' | 'generation_failed';
export type QuestionGenerationMode = 'raw_files' | 'chunked_responses' | 'chunked_low_level';
export type ProxyParseMode = 'auto' | 'raw_files' | 'chunked';

export interface AppSettings {
  timezone: string;
  activeHours: {
    startHour: number;
    endHour: number;
  };
  reminderIntervalHours: number;
  minimumSessionMinutes: number;
  targetSessionMinutes: number;
  enforcementMode: EnforcementMode;
  enforcementStyle: EnforcementStyle;
  lighterReopenDelayMinutes: number;
  questionSourceMode: QuestionSourceMode;
}

export interface MultipleChoiceAnswerSchema {
  kind: 'multiple_choice';
  options: string[];
  correctIndex: number;
}

export interface NumericAnswerSchema {
  kind: 'numeric';
  correctValue: number;
  tolerance: number;
  unitLabel?: string;
}

export interface StructuredAnswerSchema {
  kind: 'structured';
  acceptableAnswers: string[];
  placeholder?: string;
}

export interface DerivationAnswerSchema {
  kind: 'derivation';
  checklist: string[];
}

export type AnswerSchema =
  | MultipleChoiceAnswerSchema
  | NumericAnswerSchema
  | StructuredAnswerSchema
  | DerivationAnswerSchema;

export interface DraftQuestionSourceRef {
  documentId: string;
  documentName: string;
  chunkId?: string;
  locatorLabel: string;
  excerpt: string;
  pageNumber?: number;
  slideNumber?: number;
}

export interface QuestionSourceRef extends DraftQuestionSourceRef {
  chunkId: string;
}

export interface ExtractedTextChunk {
  id: string;
  order: number;
  text: string;
  locatorLabel: string;
  pageNumber?: number;
  slideNumber?: number;
}

export interface QuestionBankDocument {
  id: string;
  fileName: string;
  kind: DocumentKind;
  checksumSha256: string;
  importedAt: string;
  storedFileName: string;
  extractedTextFileName?: string;
  extractionStatus: DocumentExtractionStatus;
  extractionError?: string;
  chunkCount: number;
}

export interface DraftValidationIssue {
  field: string;
  message: string;
}

export interface QuestionFields<TCitation = DraftQuestionSourceRef> {
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
  citations: TCitation[];
}

export type DraftQuestionFields = QuestionFields<DraftQuestionSourceRef>;

export interface GeneratedQuestionDraft extends DraftQuestionFields {
  id: string;
  batchId: string;
  createdAt: string;
  updatedAt: string;
  validationIssues: DraftValidationIssue[];
  rawIndex: number;
}

export interface PublishedBankQuestion extends QuestionFields<QuestionSourceRef> {
  bankQuestionId: string;
  origin: 'generated';
  createdAt: string;
  updatedAt: string;
  sourceBatchId: string;
  archivedAt?: string;
}

export interface QuestionGenerationBatch {
  id: string;
  createdAt: string;
  updatedAt: string;
  documentIds: string[];
  requestedDraftCount: number;
  draftIds: string[];
  status: GenerationBatchStatus;
  generationMode: QuestionGenerationMode;
  completedRequestCount: number;
  totalRequestCount: number;
  repairedDraftCount: number;
  errorMessage?: string;
  modelName?: string;
}

export interface TopicDefinition {
  id: string;
  label: string;
  origin: BankQuestionOrigin;
  createdAt: string;
}

export interface QuestionBankState {
  createdAt: string;
  documents: QuestionBankDocument[];
  batches: QuestionGenerationBatch[];
  drafts: GeneratedQuestionDraft[];
  publishedQuestions: PublishedBankQuestion[];
  topics: TopicDefinition[];
}

export interface ProxyStatusView {
  configured: boolean;
  baseUrl?: string;
  model?: string;
  parseMode: ProxyParseMode;
  message: string;
}

export interface QuestionBankCoverage {
  generatedQuestionCount: number;
  missingBuckets: SelectionBucket[];
  requiresSeededFallback: boolean;
}

export interface QuestionBankSummaryEntry {
  key: string;
  label: string;
  count: number;
}

export interface QuestionBankView {
  documents: QuestionBankDocument[];
  batches: QuestionGenerationBatch[];
  drafts: GeneratedQuestionDraft[];
  publishedQuestions: PublishedBankQuestion[];
  publishedSummary: {
    activeCount: number;
    archivedCount: number;
    byBucket: QuestionBankSummaryEntry[];
    byTopic: QuestionBankSummaryEntry[];
    coverage: QuestionBankCoverage;
  };
  proxyStatus: ProxyStatusView;
}

export interface Question {
  id: string;
  bankQuestionId: string;
  origin: BankQuestionOrigin;
  templateId: string;
  title: string;
  source: string;
  topicId: string;
  topicLabel: string;
  topicTag: string;
  difficulty: Difficulty;
  promptType: PromptType;
  stem: string;
  hint?: string;
  workedSolution: string;
  answerSchema: AnswerSchema;
}

export interface AttemptEvaluation {
  correct: boolean;
  feedback: string;
  expected?: string;
  weakTopicSignal: number;
  submittedAt: string;
}

export interface QuestionProgress {
  answerText?: string;
  evaluation?: AttemptEvaluation;
  revealedSolutionAt?: string;
  selfCheck?: SelfCheckRating;
}

export interface PracticeSession {
  id: string;
  slotId: string;
  scheduledFor: string;
  status: SessionStatus;
  startedAt?: string;
  completedAt?: string;
  lastPromptedAt?: string;
  minDurationMs: number;
  targetDurationMs: number;
  questions: Question[];
  responses: Record<string, QuestionProgress>;
}

export interface AppState {
  createdAt: string;
  settings: AppSettings;
  sessions: PracticeSession[];
  activeSessionId?: string;
  weakTopicScores: Record<string, number>;
}

export interface ScheduleSlotView {
  slotId: string;
  scheduledFor: string;
  label: string;
  status: 'upcoming' | 'queued' | 'active' | 'completed';
}

export interface TopicScore {
  topicId: string;
  topicTag: string;
  label: string;
  score: number;
}

export interface HistoryPoint {
  dateKey: string;
  completed: number;
}

export interface ActiveSessionStatus {
  answeredCount: number;
  totalQuestions: number;
  minDurationMet: boolean;
  remainingMs: number;
  canComplete: boolean;
}

export interface AppSnapshot {
  now: string;
  settings: AppSettings;
  activeSession: PracticeSession | null;
  activeSessionStatus: ActiveSessionStatus | null;
  schedule: ScheduleSlotView[];
  weakTopics: TopicScore[];
  history: HistoryPoint[];
  streakDays: number;
  completedToday: number;
  pendingCount: number;
  overdueSummary: string | null;
}
