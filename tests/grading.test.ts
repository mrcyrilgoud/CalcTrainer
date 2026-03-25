import { describe, expect, it } from 'vitest';

import { evaluateAnswer } from '../src/shared/practice';
import { Question } from '../src/shared/types';

const now = new Date(2026, 2, 23, 12, 0, 0, 0);

describe('grading', () => {
  it('grades multiple choice answers exactly', () => {
    const question: Question = {
      id: 'mc',
      templateId: 'mc',
      title: 'Momentum',
      source: 'Lecture 5.pdf',
      topicTag: 'learning_rate_and_optimizer',
      difficulty: 'medium',
      promptType: 'multiple_choice',
      stem: 'Pick the correct option.',
      workedSolution: 'Momentum keeps useful direction.',
      answerSchema: {
        kind: 'multiple_choice',
        options: ['Wrong', 'Right'],
        correctIndex: 1
      }
    };

    expect(evaluateAnswer(question, '1', now).correct).toBe(true);
    expect(evaluateAnswer(question, '0', now).correct).toBe(false);
  });

  it('grades numeric answers using tolerance', () => {
    const question: Question = {
      id: 'num',
      templateId: 'num',
      title: 'Conv size',
      source: 'Lecture 6.pdf',
      topicTag: 'conv_output_size',
      difficulty: 'medium',
      promptType: 'numeric',
      stem: 'Compute output size.',
      workedSolution: '28',
      answerSchema: {
        kind: 'numeric',
        correctValue: 28,
        tolerance: 0
      }
    };

    expect(evaluateAnswer(question, '28', now).correct).toBe(true);
    expect(evaluateAnswer(question, '27', now).correct).toBe(false);
  });

  it('normalizes structured answers before comparison', () => {
    const question: Question = {
      id: 'structured',
      templateId: 'structured',
      title: 'Sigmoid derivative',
      source: 'Lecture 4.pdf',
      topicTag: 'sigmoid_tanh_relu_derivatives',
      difficulty: 'medium',
      promptType: 'structured',
      stem: 'Write the derivative.',
      workedSolution: 'sigma(z) * (1 - sigma(z))',
      answerSchema: {
        kind: 'structured',
        acceptableAnswers: ['sigma(z)*(1-sigma(z))']
      }
    };

    expect(evaluateAnswer(question, ' sigma(z) * (1 - sigma(z)) ', now).correct).toBe(true);
    expect(evaluateAnswer(question, '1 - sigma(z)', now).correct).toBe(false);
  });
});
