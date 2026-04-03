import { contextBridge, ipcRenderer } from 'electron';

import { AppSettings, DraftQuestionFields, SelfCheckRating } from './shared/types';

type SnapshotListener = (snapshot: unknown) => void;

contextBridge.exposeInMainWorld('calcTrainer', {
  getSnapshot: () => ipcRenderer.invoke('snapshot:get'),
  openDashboard: () => ipcRenderer.invoke('dashboard:open'),
  openPractice: () => ipcRenderer.invoke('practice:open'),
  hidePracticeWindow: () => ipcRenderer.invoke('practice:hide'),
  getQuestionBank: () => ipcRenderer.invoke('questionBank:get'),
  importDocuments: () => ipcRenderer.invoke('questionBank:importDocuments'),
  generateDraftBatch: (payload: { documentIds: string[] }) => ipcRenderer.invoke('questionBank:generateDraftBatch', payload),
  updateDraft: (payload: { draftId: string; fields: Partial<DraftQuestionFields> }) =>
    ipcRenderer.invoke('questionBank:updateDraft', payload),
  deleteDraft: (payload: { draftId?: string; batchId?: string }) => ipcRenderer.invoke('questionBank:deleteDraft', payload),
  publishDrafts: (payload: { draftIds: string[] }) => ipcRenderer.invoke('questionBank:publishDrafts', payload),
  archivePublished: (payload: { questionIds: string[] }) => ipcRenderer.invoke('questionBank:archivePublished', payload),
  updateSettings: (payload: Partial<Pick<AppSettings, 'enforcementStyle' | 'lighterReopenDelayMinutes' | 'questionSourceMode'>>) =>
    ipcRenderer.invoke('settings:update', payload),
  submitAnswer: (payload: { sessionId: string; questionId: string; answerText: string }) =>
    ipcRenderer.invoke('session:submit-answer', payload),
  revealSolution: (payload: { sessionId: string; questionId: string }) =>
    ipcRenderer.invoke('session:reveal-solution', payload),
  selfCheck: (payload: { sessionId: string; questionId: string; rating: SelfCheckRating }) =>
    ipcRenderer.invoke('session:self-check', payload),
  completeSession: (payload: { sessionId: string }) => ipcRenderer.invoke('session:complete', payload),
  onSnapshot: (listener: SnapshotListener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, snapshot: unknown) => listener(snapshot);
    ipcRenderer.on('snapshot:updated', wrappedListener);
    return () => ipcRenderer.removeListener('snapshot:updated', wrappedListener);
  }
});
