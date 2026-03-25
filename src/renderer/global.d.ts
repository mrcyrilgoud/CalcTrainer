interface CalcTrainerApi {
  getSnapshot(): Promise<unknown>;
  openDashboard(): Promise<unknown>;
  openPractice(): Promise<unknown>;
  hidePracticeWindow(): Promise<unknown>;
  updateSettings(payload: {
    enforcementStyle?: 'strict' | 'lighter';
    lighterReopenDelayMinutes?: number;
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
