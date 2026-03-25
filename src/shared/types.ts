export const TOPIC_TAGS = [
  'binary_bce_backprop',
  'sigmoid_tanh_relu_derivatives',
  'multiclass_softmax_cross_entropy',
  'learning_rate_and_optimizer',
  'conv_output_size',
  'padding_stride_pooling',
  'conv_parameter_count'
] as const;

export type TopicTag = (typeof TOPIC_TAGS)[number];
export type Difficulty = 'medium' | 'hard';
export type PromptType = 'multiple_choice' | 'numeric' | 'structured' | 'derivation';
export type EnforcementMode = 'must_finish_session';
export type EnforcementStyle = 'strict' | 'lighter';
export type SessionStatus = 'pending' | 'active' | 'completed';
export type SelfCheckRating = 'needs_work' | 'solid';

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

export interface Question {
  id: string;
  templateId: string;
  title: string;
  source: string;
  topicTag: TopicTag;
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
  weakTopicScores: Record<TopicTag, number>;
}

export interface ScheduleSlotView {
  slotId: string;
  scheduledFor: string;
  label: string;
  status: 'upcoming' | 'queued' | 'active' | 'completed';
}

export interface TopicScore {
  topicTag: TopicTag;
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
