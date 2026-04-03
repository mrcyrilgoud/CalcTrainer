interface CalcTrainerApi {
  getSnapshot(): Promise<unknown>;
  getQuestionBank(): Promise<unknown>;
  openDashboard(): Promise<unknown>;
  openPractice(): Promise<unknown>;
  hidePracticeWindow(): Promise<unknown>;
  importDocuments(): Promise<unknown>;
  generateDraftBatch(payload: { documentIds: string[] }): Promise<unknown>;
  updateDraft(payload: { draftId: string; fields: Record<string, unknown> }): Promise<unknown>;
  deleteDraft(payload: { draftId?: string; batchId?: string }): Promise<unknown>;
  publishDrafts(payload: { draftIds: string[] }): Promise<unknown>;
  archivePublished(payload: { questionIds: string[] }): Promise<unknown>;
  updateSettings(payload: {
    enforcementStyle?: 'strict' | 'lighter';
    lighterReopenDelayMinutes?: number;
    questionSourceMode?: 'seeded' | 'generated' | 'mixed';
  }): Promise<unknown>;
  submitAnswer(payload: { sessionId: string; questionId: string; answerText: string }): Promise<unknown>;
  revealSolution(payload: { sessionId: string; questionId: string }): Promise<unknown>;
  selfCheck(payload: { sessionId: string; questionId: string; rating: 'needs_work' | 'solid' }): Promise<unknown>;
  completeSession(payload: { sessionId: string }): Promise<unknown>;
  onSnapshot(listener: (snapshot: unknown) => void): () => void;
}

interface Window {
  calcTrainer: CalcTrainerApi;
}
