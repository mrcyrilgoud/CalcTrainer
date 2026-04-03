import { SESSION_QUESTION_COUNT } from './settings';
import { AppState, Difficulty, PromptType, PublishedBankQuestion, Question, QuestionBankState, SEEDED_TOPIC_LABELS, SelectionBucket, TopicTag } from './types';

type BuiltSeededQuestion = Omit<Question, 'id' | 'bankQuestionId' | 'origin' | 'topicId' | 'topicLabel'>;

type QuestionTemplate = {
  id: string;
  source: string;
  topicTag: TopicTag;
  difficulty: Difficulty;
  promptType: PromptType;
  bucket: SelectionBucket;
  build: (rng: () => number, slotId: string) => BuiltSeededQuestion;
};

function hashString(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed: string): () => number {
  let state = hashString(seed) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function choice<T>(rng: () => number, values: T[]): T {
  const index = Math.floor(rng() * values.length);
  return values[index] as T;
}

function weightedPick<T>(rng: () => number, entries: Array<{ item: T; weight: number }>): T {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = rng() * totalWeight;
  for (const entry of entries) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry.item;
    }
  }
  return entries[entries.length - 1]!.item;
}

function shuffle<T>(rng: () => number, values: T[]): T[] {
  const clone = [...values];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const current = clone[index];
    clone[index] = clone[swapIndex] as T;
    clone[swapIndex] = current as T;
  }
  return clone;
}

function makeId(slotId: string, templateId: string): string {
  return `${slotId}::${templateId}`;
}

type QuestionBankCandidate = {
  bankQuestionId: string;
  origin: 'seeded' | 'generated';
  topicTag: string;
  topicLabel: string;
  bucket: SelectionBucket;
  materialize: (rng: () => number, slotId: string) => Question;
};

const QUESTION_TEMPLATES: QuestionTemplate[] = [
  {
    id: 'binary-output-delta',
    source: 'Lecture 4.pdf',
    topicTag: 'binary_bce_backprop',
    difficulty: 'medium',
    promptType: 'structured',
    bucket: 'backprop_auto',
    build: () => ({
      templateId: 'binary-output-delta',
      title: 'Binary Output Delta',
      source: 'Lecture 4.pdf',
      topicTag: 'binary_bce_backprop',
      difficulty: 'medium',
      promptType: 'structured',
      stem: 'For binary cross-entropy with a sigmoid output neuron, write dL/dz^(2) in its compact form. Use only a^(2) and y.',
      hint: 'Lecture 4 simplifies BCE plus sigmoid into a single output delta.',
      workedSolution: 'Because BCE and sigmoid combine cleanly, dL/dz^(2) = a^(2) - y.',
      answerSchema: {
        kind: 'structured',
        acceptableAnswers: ['a^(2)-y', 'a2-y', 'a[2]-y', 'yhat-y'],
        placeholder: 'a^(2) - y'
      }
    })
  },
  {
    id: 'binary-output-weight',
    source: 'assignment5.pdf',
    topicTag: 'binary_bce_backprop',
    difficulty: 'medium',
    promptType: 'structured',
    bucket: 'backprop_auto',
    build: (rng) => {
      const hiddenNode = choice(rng, [1, 2]);
      return {
        templateId: 'binary-output-weight',
        title: 'Binary Output Weight Gradient',
        source: 'assignment5.pdf',
        topicTag: 'binary_bce_backprop',
        difficulty: 'medium',
        promptType: 'structured',
        stem: `In the 2-hidden-unit assignment network, write dL/dW${hiddenNode}^(2). Use the compact BCE delta and the matching hidden activation.`,
        hint: 'Output-layer gradients are output delta times the incoming activation.',
        workedSolution: `dL/dW${hiddenNode}^(2) = (a^(2) - y) * a${hiddenNode}^(1).`,
        answerSchema: {
          kind: 'structured',
          acceptableAnswers: [
            `(a^(2)-y)*a${hiddenNode}^(1)`,
            `(a2-y)*a${hiddenNode}^(1)`,
            `(a[2]-y)*a${hiddenNode}^(1)`,
            `(yhat-y)*a${hiddenNode}^(1)`
          ],
          placeholder: `(a^(2) - y) * a${hiddenNode}^(1)`
        }
      };
    }
  },
  {
    id: 'binary-hidden-derivation',
    source: 'DATA255_12_assignment5.pdf',
    topicTag: 'binary_bce_backprop',
    difficulty: 'hard',
    promptType: 'derivation',
    bucket: 'derivation',
    build: () => ({
      templateId: 'binary-hidden-derivation',
      title: 'Binary Hidden-Layer Derivation',
      source: 'DATA255_12_assignment5.pdf',
      topicTag: 'binary_bce_backprop',
      difficulty: 'hard',
      promptType: 'derivation',
      stem: 'Derive dL/dW11^(1) for the one-output assignment network. Write the full chain-rule path from the BCE loss back to the first hidden weight.',
      hint: 'Start with the output delta, then pass through W1^(2), then the hidden sigmoid derivative, then the input a1^(0).',
      workedSolution:
        'dL/dW11^(1) = (a^(2) - y) * W1^(2) * a1^(1) * (1 - a1^(1)) * a1^(0).\nThe path is loss -> z^(2) -> a1^(1) -> W11^(1).',
      answerSchema: {
        kind: 'derivation',
        checklist: [
          'Output delta appears as a^(2) - y.',
          'The chain includes W1^(2).',
          'The hidden sigmoid derivative a1^(1) * (1 - a1^(1)) appears.',
          'The final factor is the input activation a1^(0).'
        ]
      }
    })
  },
  {
    id: 'sigmoid-derivative',
    source: 'Lecture 4.pdf',
    topicTag: 'sigmoid_tanh_relu_derivatives',
    difficulty: 'medium',
    promptType: 'structured',
    bucket: 'backprop_auto',
    build: () => ({
      templateId: 'sigmoid-derivative',
      title: 'Sigmoid Derivative',
      source: 'Lecture 4.pdf',
      topicTag: 'sigmoid_tanh_relu_derivatives',
      difficulty: 'medium',
      promptType: 'structured',
      stem: 'Write d/dz sigma(z) in the factorized form emphasized in Lecture 4.',
      hint: 'Express the derivative using sigma(z) itself.',
      workedSolution: 'd/dz sigma(z) = sigma(z) * (1 - sigma(z)).',
      answerSchema: {
        kind: 'structured',
        acceptableAnswers: [
          'sigma(z)*(1-sigma(z))',
          'sigmoid(z)*(1-sigmoid(z))'
        ],
        placeholder: 'sigma(z) * (1 - sigma(z))'
      }
    })
  },
  {
    id: 'tanh-derivative',
    source: 'Lecture 4.pdf',
    topicTag: 'sigmoid_tanh_relu_derivatives',
    difficulty: 'medium',
    promptType: 'structured',
    bucket: 'backprop_auto',
    build: () => ({
      templateId: 'tanh-derivative',
      title: 'Tanh Derivative',
      source: 'Lecture 4.pdf',
      topicTag: 'sigmoid_tanh_relu_derivatives',
      difficulty: 'medium',
      promptType: 'structured',
      stem: 'Write d/dz tanh(z) in terms of tanh(z).',
      hint: 'Lecture 4 uses the square of tanh(z).',
      workedSolution: 'd/dz tanh(z) = 1 - tanh(z)^2.',
      answerSchema: {
        kind: 'structured',
        acceptableAnswers: ['1-tanh(z)^2', '1-(tanh(z))^2'],
        placeholder: '1 - tanh(z)^2'
      }
    })
  },
  {
    id: 'relu-negative-region',
    source: 'Lecture 4.pdf',
    topicTag: 'sigmoid_tanh_relu_derivatives',
    difficulty: 'medium',
    promptType: 'multiple_choice',
    bucket: 'concept',
    build: (rng) => {
      const options = shuffle(rng, ['ReLU', 'Sigmoid', 'Tanh', 'ELU']);
      return {
        templateId: 'relu-negative-region',
        title: 'Activation Behavior',
        source: 'Lecture 4.pdf',
        topicTag: 'sigmoid_tanh_relu_derivatives',
        difficulty: 'medium',
        promptType: 'multiple_choice',
        stem: 'Which activation has derivative 0 for every strictly negative input z < 0?',
        hint: 'Lecture 4 contrasts ReLU with leaky variants.',
        workedSolution: 'Standard ReLU has derivative 0 on the negative side; leaky ReLU and ELU do not.',
        answerSchema: {
          kind: 'multiple_choice',
          options,
          correctIndex: options.indexOf('ReLU')
        }
      };
    }
  },
  {
    id: 'softmax-output-delta',
    source: 'Lecture 5.pdf',
    topicTag: 'multiclass_softmax_cross_entropy',
    difficulty: 'medium',
    promptType: 'structured',
    bucket: 'backprop_auto',
    build: () => ({
      templateId: 'softmax-output-delta',
      title: 'Softmax Output Delta',
      source: 'Lecture 5.pdf',
      topicTag: 'multiclass_softmax_cross_entropy',
      difficulty: 'medium',
      promptType: 'structured',
      stem: 'For softmax with cross-entropy loss, write dL/dz_i^(2) in the compact classwise form.',
      hint: 'Lecture 5 arrives at a prediction-minus-target expression for each output node.',
      workedSolution: 'For each class i, dL/dz_i^(2) = a_i^(2) - y_i.',
      answerSchema: {
        kind: 'structured',
        acceptableAnswers: ['a_i^(2)-y_i', 'ai^(2)-yi', 'ai-yi'],
        placeholder: 'a_i^(2) - y_i'
      }
    })
  },
  {
    id: 'softmax-off-diagonal',
    source: 'Lecture 5.pdf',
    topicTag: 'multiclass_softmax_cross_entropy',
    difficulty: 'medium',
    promptType: 'multiple_choice',
    bucket: 'concept',
    build: (rng) => {
      const options = shuffle(rng, [
        '-S(zi) * S(zj)',
        'S(zi) * (1 - S(zi))',
        '1 / S(zi)',
        'S(zj) - yj'
      ]);
      return {
        templateId: 'softmax-off-diagonal',
        title: 'Softmax Jacobian Entry',
        source: 'Lecture 5.pdf',
        topicTag: 'multiclass_softmax_cross_entropy',
        difficulty: 'medium',
        promptType: 'multiple_choice',
        stem: 'For i != j, which expression matches dS(zj)/dzi from the softmax derivative table?',
        hint: 'The off-diagonal entries are negative products of two softmax terms.',
        workedSolution: 'For i != j, dS(zj)/dzi = -S(zi) * S(zj).',
        answerSchema: {
          kind: 'multiple_choice',
          options,
          correctIndex: options.indexOf('-S(zi) * S(zj)')
        }
      };
    }
  },
  {
    id: 'multiclass-hidden-derivation',
    source: 'assignment5.pdf',
    topicTag: 'multiclass_softmax_cross_entropy',
    difficulty: 'hard',
    promptType: 'derivation',
    bucket: 'derivation',
    build: () => ({
      templateId: 'multiclass-hidden-derivation',
      title: 'Multiclass Hidden-Layer Derivation',
      source: 'assignment5.pdf',
      topicTag: 'multiclass_softmax_cross_entropy',
      difficulty: 'hard',
      promptType: 'derivation',
      stem: 'Derive dL/dW11^(1) for the two-output assignment network. Show why the hidden-node gradient sums contributions from both output nodes.',
      hint: 'The hidden node fans out to both outputs, so both output deltas must be included before the hidden sigmoid derivative.',
      workedSolution:
        'dL/dW11^(1) = ((a1^(2) - y1) * W11^(2) + (a2^(2) - y2) * W21^(2)) * a1^(1) * (1 - a1^(1)) * a1^(0).\nThe sum comes from the two backward paths through output nodes 1 and 2.',
      answerSchema: {
        kind: 'derivation',
        checklist: [
          'Each output node contributes a term of the form a_k^(2) - y_k.',
          'The two output-path contributions are summed.',
          'The hidden sigmoid derivative a1^(1) * (1 - a1^(1)) appears.',
          'The final factor is the first input activation a1^(0).'
        ]
      }
    })
  },
  {
    id: 'learning-rate-too-high',
    source: 'Lecture 5.pdf',
    topicTag: 'learning_rate_and_optimizer',
    difficulty: 'medium',
    promptType: 'multiple_choice',
    bucket: 'concept',
    build: (rng) => {
      const options = shuffle(rng, [
        'Parameters overshoot and the loss can oscillate or diverge.',
        'Training becomes identical to mini-batch gradient descent.',
        'The model always converges faster with no downside.',
        'The gradients become exactly zero after one step.'
      ]);
      return {
        templateId: 'learning-rate-too-high',
        title: 'Learning Rate Failure Mode',
        source: 'Lecture 5.pdf',
        topicTag: 'learning_rate_and_optimizer',
        difficulty: 'medium',
        promptType: 'multiple_choice',
        stem: 'According to Lecture 5, what usually happens when the learning rate is too high?',
        hint: 'Look for the behavior where updates are too aggressive.',
        workedSolution: 'If the learning rate is too high, optimization can overshoot the minimum and fail to settle.',
        answerSchema: {
          kind: 'multiple_choice',
          options,
          correctIndex: options.indexOf('Parameters overshoot and the loss can oscillate or diverge.')
        }
      };
    }
  },
  {
    id: 'mini-batch-definition',
    source: 'Lecture 5.pdf',
    topicTag: 'learning_rate_and_optimizer',
    difficulty: 'medium',
    promptType: 'multiple_choice',
    bucket: 'concept',
    build: (rng) => {
      const options = shuffle(rng, [
        'It computes gradients on small random sets of instances.',
        'It computes gradients on the full training set every update.',
        'It updates one parameter at a time instead of all weights.',
        'It removes the need for a learning rate.'
      ]);
      return {
        templateId: 'mini-batch-definition',
        title: 'Mini-Batch Gradient Descent',
        source: 'Lecture 5.pdf',
        topicTag: 'learning_rate_and_optimizer',
        difficulty: 'medium',
        promptType: 'multiple_choice',
        stem: 'Which description matches mini-batch gradient descent in Lecture 5?',
        hint: 'It sits between batch gradient descent and stochastic gradient descent.',
        workedSolution: 'Mini-batch gradient descent computes gradients on small random subsets of the training set.',
        answerSchema: {
          kind: 'multiple_choice',
          options,
          correctIndex: options.indexOf('It computes gradients on small random sets of instances.')
        }
      };
    }
  },
  {
    id: 'momentum-intuition',
    source: 'Lecture 5.pdf',
    topicTag: 'learning_rate_and_optimizer',
    difficulty: 'medium',
    promptType: 'multiple_choice',
    bucket: 'concept',
    build: (rng) => {
      const options = shuffle(rng, [
        'It accumulates a velocity term so updates keep useful direction across steps.',
        'It replaces gradients with random noise to escape every minimum.',
        'It forces every parameter to share the same value.',
        'It guarantees the exact minimum in one update.'
      ]);
      return {
        templateId: 'momentum-intuition',
        title: 'Momentum Intuition',
        source: 'Lecture 5.pdf',
        topicTag: 'learning_rate_and_optimizer',
        difficulty: 'medium',
        promptType: 'multiple_choice',
        stem: 'What is the main intuition behind momentum-based gradient optimization?',
        hint: 'Lecture 5 introduces a velocity variable v.',
        workedSolution: 'Momentum keeps part of the previous update direction, which helps smooth noisy gradients and move faster through shallow directions.',
        answerSchema: {
          kind: 'multiple_choice',
          options,
          correctIndex: options.indexOf('It accumulates a velocity term so updates keep useful direction across steps.')
        }
      };
    }
  },
  {
    id: 'conv-output-side',
    source: 'Lecture 6.pdf',
    topicTag: 'conv_output_size',
    difficulty: 'medium',
    promptType: 'numeric',
    bucket: 'cnn_auto',
    build: (rng) => {
      const cases = [
        { n: 28, k: 3, p: 1, s: 1 },
        { n: 32, k: 5, p: 0, s: 1 },
        { n: 64, k: 3, p: 0, s: 2 },
        { n: 30, k: 4, p: 1, s: 2 }
      ];
      const sample = choice(rng, cases);
      const correctValue = ((sample.n + 2 * sample.p - sample.k) / sample.s) + 1;
      return {
        templateId: 'conv-output-side',
        title: 'Convolution Output Size',
        source: 'Lecture 6.pdf',
        topicTag: 'conv_output_size',
        difficulty: 'medium',
        promptType: 'numeric',
        stem: `A square image has n=${sample.n}, kernel size k=${sample.k}, padding p=${sample.p}, and stride s=${sample.s}. What is the output height?`,
        hint: 'Use ((n + 2p - k) / s) + 1.',
        workedSolution: `Output height = ((${sample.n} + 2*${sample.p} - ${sample.k}) / ${sample.s}) + 1 = ${correctValue}.`,
        answerSchema: {
          kind: 'numeric',
          correctValue,
          tolerance: 0,
          unitLabel: 'cells'
        }
      };
    }
  },
  {
    id: 'conv-formula-structured',
    source: 'Lecture 6.pdf',
    topicTag: 'conv_output_size',
    difficulty: 'medium',
    promptType: 'structured',
    bucket: 'cnn_auto',
    build: () => ({
      templateId: 'conv-formula-structured',
      title: 'Convolution Formula Recall',
      source: 'Lecture 6.pdf',
      topicTag: 'conv_output_size',
      difficulty: 'medium',
      promptType: 'structured',
      stem: 'Write the 1D output-size formula for convolution in terms of n, p, k, and s.',
      hint: 'Lecture 6 presents the output side as one fraction plus 1.',
      workedSolution: 'Output side = ((n + 2p - k) / s) + 1.',
      answerSchema: {
        kind: 'structured',
        acceptableAnswers: ['((n+2p-k)/s)+1', '(n+2p-k)/s+1'],
        placeholder: '((n + 2p - k) / s) + 1'
      }
    })
  },
  {
    id: 'pooling-output-size',
    source: 'Lecture 6.pdf',
    topicTag: 'padding_stride_pooling',
    difficulty: 'medium',
    promptType: 'numeric',
    bucket: 'cnn_auto',
    build: (rng) => {
      const cases = [
        { n: 28, f: 2, s: 2, p: 0 },
        { n: 32, f: 2, s: 2, p: 0 },
        { n: 30, f: 3, s: 3, p: 0 }
      ];
      const sample = choice(rng, cases);
      const correctValue = ((sample.n + 2 * sample.p - sample.f) / sample.s) + 1;
      return {
        templateId: 'pooling-output-size',
        title: 'Pooling Output Size',
        source: 'Lecture 6.pdf',
        topicTag: 'padding_stride_pooling',
        difficulty: 'medium',
        promptType: 'numeric',
        stem: `A pooling layer uses input size n=${sample.n}, filter f=${sample.f}, stride s=${sample.s}, and padding p=${sample.p}. What is the output height?`,
        hint: 'Pooling uses the same size formula as convolution, but there are no learned parameters.',
        workedSolution: `Output height = ((${sample.n} + 2*${sample.p} - ${sample.f}) / ${sample.s}) + 1 = ${correctValue}.`,
        answerSchema: {
          kind: 'numeric',
          correctValue,
          tolerance: 0,
          unitLabel: 'cells'
        }
      };
    }
  },
  {
    id: 'valid-vs-same',
    source: 'Lecture 6.pdf',
    topicTag: 'padding_stride_pooling',
    difficulty: 'medium',
    promptType: 'multiple_choice',
    bucket: 'concept',
    build: (rng) => {
      const options = shuffle(rng, [
        'Valid convolution uses no padding; same convolution uses zero padding to preserve spatial size.',
        'Valid convolution always uses stride 2; same convolution always uses stride 1.',
        'Valid convolution uses average pooling; same convolution uses max pooling.',
        'Valid convolution is only for grayscale images; same convolution is only for RGB images.'
      ]);
      return {
        templateId: 'valid-vs-same',
        title: 'Valid vs Same',
        source: 'Lecture 6.pdf',
        topicTag: 'padding_stride_pooling',
        difficulty: 'medium',
        promptType: 'multiple_choice',
        stem: 'Which statement matches the Lecture 6 distinction between valid and same convolution?',
        hint: 'The difference is about padding and output size.',
        workedSolution: 'Valid convolution has no padding. Same convolution uses zero padding so the output size matches the input size.',
        answerSchema: {
          kind: 'multiple_choice',
          options,
          correctIndex: options.indexOf('Valid convolution uses no padding; same convolution uses zero padding to preserve spatial size.')
        }
      };
    }
  },
  {
    id: 'stride-effect',
    source: 'Lecture 6.pdf',
    topicTag: 'padding_stride_pooling',
    difficulty: 'medium',
    promptType: 'multiple_choice',
    bucket: 'concept',
    build: (rng) => {
      const options = shuffle(rng, [
        'Increasing stride generally reduces the spatial size of the output feature map.',
        'Increasing stride always increases the number of learned parameters.',
        'Increasing stride changes max pooling into average pooling.',
        'Increasing stride makes padding unnecessary in every case.'
      ]);
      return {
        templateId: 'stride-effect',
        title: 'Stride Effect',
        source: 'Lecture 6.pdf',
        topicTag: 'padding_stride_pooling',
        difficulty: 'medium',
        promptType: 'multiple_choice',
        stem: 'What is the usual effect of increasing stride from 1 to 2 in a convolution layer?',
        hint: 'The kernel jumps farther between positions.',
        workedSolution: 'Larger stride samples fewer spatial positions, so the feature map becomes smaller.',
        answerSchema: {
          kind: 'multiple_choice',
          options,
          correctIndex: options.indexOf('Increasing stride generally reduces the spatial size of the output feature map.')
        }
      };
    }
  },
  {
    id: 'conv-parameter-count',
    source: 'Lecture 6.pdf',
    topicTag: 'conv_parameter_count',
    difficulty: 'medium',
    promptType: 'numeric',
    bucket: 'cnn_auto',
    build: (rng) => {
      const cases = [
        { f: 3, channelsIn: 3, filters: 8 },
        { f: 5, channelsIn: 1, filters: 6 },
        { f: 3, channelsIn: 16, filters: 32 }
      ];
      const sample = choice(rng, cases);
      const perFilter = (sample.f * sample.f * sample.channelsIn) + 1;
      const correctValue = perFilter * sample.filters;
      return {
        templateId: 'conv-parameter-count',
        title: 'Convolution Parameter Count',
        source: 'Lecture 6.pdf',
        topicTag: 'conv_parameter_count',
        difficulty: 'medium',
        promptType: 'numeric',
        stem: `A convolution layer has filter size ${sample.f}x${sample.f}, ${sample.channelsIn} input channels, and ${sample.filters} filters. How many learned parameters does the layer have, including one bias per filter?`,
        hint: 'Each filter has f*f*channelsIn weights plus one bias.',
        workedSolution: `Parameters = ((${sample.f}*${sample.f}*${sample.channelsIn}) + 1) * ${sample.filters} = ${correctValue}.`,
        answerSchema: {
          kind: 'numeric',
          correctValue,
          tolerance: 0,
          unitLabel: 'parameters'
        }
      };
    }
  },
  {
    id: 'conv-parameter-lecture-example',
    source: 'Lecture 6.pdf',
    topicTag: 'conv_parameter_count',
    difficulty: 'medium',
    promptType: 'numeric',
    bucket: 'cnn_auto',
    build: () => ({
      templateId: 'conv-parameter-lecture-example',
      title: 'Lecture 6 Parameter Example',
      source: 'Lecture 6.pdf',
      topicTag: 'conv_parameter_count',
      difficulty: 'medium',
      promptType: 'numeric',
      stem: 'Lecture 6 asks: if there are 10 filters of size 3x3x3 in one convolution layer, how many learned parameters are there including bias?',
      hint: 'One filter has 27 weights and 1 bias.',
      workedSolution: 'Each filter has 3*3*3 = 27 weights plus 1 bias, so 28 per filter. With 10 filters, 28 * 10 = 280.',
      answerSchema: {
        kind: 'numeric',
        correctValue: 280,
        tolerance: 0,
        unitLabel: 'parameters'
      }
    })
  }
];

const BACKPROP_TOPICS: TopicTag[] = [
  'binary_bce_backprop',
  'sigmoid_tanh_relu_derivatives',
  'multiclass_softmax_cross_entropy'
];

const CNN_TOPICS: TopicTag[] = [
  'conv_output_size',
  'padding_stride_pooling',
  'conv_parameter_count'
];

function topicWeight(topicTag: string, state: AppState): number {
  const weakScore = state.weakTopicScores[topicTag] ?? 0;
  const assignmentBoost = topicTag === 'binary_bce_backprop' || topicTag === 'multiclass_softmax_cross_entropy' ? 1.6 : 1;
  return 1 + weakScore * 0.55 + assignmentBoost;
}

function createSeededCandidate(template: QuestionTemplate): QuestionBankCandidate {
  const topicLabel = SEEDED_TOPIC_LABELS[template.topicTag as keyof typeof SEEDED_TOPIC_LABELS] ?? template.topicTag;
  return {
    bankQuestionId: `seeded:${template.id}`,
    origin: 'seeded',
    topicTag: template.topicTag,
    topicLabel,
    bucket: template.bucket,
    materialize: (rng, slotId) => {
      const question = template.build(rng, slotId);
      return {
        id: makeId(slotId, template.id),
        bankQuestionId: `seeded:${template.id}`,
        origin: 'seeded',
        topicId: template.topicTag,
        topicLabel,
        ...question
      };
    }
  };
}

function createGeneratedCandidate(question: PublishedBankQuestion): QuestionBankCandidate {
  return {
    bankQuestionId: question.bankQuestionId,
    origin: 'generated',
    topicTag: question.topicId,
    topicLabel: question.topicLabel,
    bucket: question.selectionBucket,
    materialize: (_rng, slotId) => ({
      id: makeId(slotId, question.bankQuestionId),
      bankQuestionId: question.bankQuestionId,
      origin: 'generated',
      templateId: question.bankQuestionId,
      title: question.title,
      source: question.source,
      topicId: question.topicId,
      topicLabel: question.topicLabel,
      topicTag: question.topicId,
      difficulty: question.difficulty,
      promptType: question.promptType,
      stem: question.stem,
      hint: question.hint,
      workedSolution: question.workedSolution,
      answerSchema: question.answerSchema
    })
  };
}

function pickUniqueCandidate(
  rng: () => number,
  state: AppState,
  chosenIds: Set<string>,
  candidates: QuestionBankCandidate[],
  predicate: (candidate: QuestionBankCandidate) => boolean
): QuestionBankCandidate | null {
  const matchingCandidates = candidates.filter((candidate) => !chosenIds.has(candidate.bankQuestionId) && predicate(candidate));
  if (matchingCandidates.length === 0) {
    return null;
  }
  const weightedCandidates = matchingCandidates.map((candidate) => ({
    item: candidate,
    weight: topicWeight(candidate.topicTag, state)
  }));
  return weightedPick(rng, weightedCandidates);
}

function resolveCandidatePools(state: AppState, questionBankState?: QuestionBankState): {
  primary: QuestionBankCandidate[];
  fallback: QuestionBankCandidate[];
} {
  const publishedQuestions = questionBankState?.publishedQuestions ?? [];
  const seededCandidates = QUESTION_TEMPLATES.map(createSeededCandidate);
  const generatedCandidates = publishedQuestions
    .filter((question) => !question.archivedAt)
    .map(createGeneratedCandidate);

  switch (state.settings.questionSourceMode) {
    case 'generated':
      return {
        primary: generatedCandidates,
        fallback: seededCandidates
      };
    case 'mixed':
      return {
        primary: [...generatedCandidates, ...seededCandidates],
        fallback: []
      };
    case 'seeded':
    default:
      return {
        primary: seededCandidates,
        fallback: []
      };
  }
}

function pickCandidateWithFallback(
  rng: () => number,
  state: AppState,
  chosenIds: Set<string>,
  pools: { primary: QuestionBankCandidate[]; fallback: QuestionBankCandidate[] },
  predicate: (candidate: QuestionBankCandidate) => boolean
): QuestionBankCandidate {
  const primaryPick = pickUniqueCandidate(rng, state, chosenIds, pools.primary, predicate);
  if (primaryPick) {
    return primaryPick;
  }

  const fallbackPick = pickUniqueCandidate(rng, state, chosenIds, pools.fallback, predicate);
  if (fallbackPick) {
    return fallbackPick;
  }

  const anyPick = pickUniqueCandidate(rng, state, chosenIds, [...pools.primary, ...pools.fallback], () => true);
  if (anyPick) {
    return anyPick;
  }

  throw new Error('CalcTrainer could not assemble a question set from the available bank.');
}

export function generateQuestionsForSession(state: AppState, slotId: string, questionBankState?: QuestionBankState): Question[] {
  const rng = createRng(slotId);
  const chosenCandidateIds = new Set<string>();
  const candidates: QuestionBankCandidate[] = [];
  const pools = resolveCandidatePools(state, questionBankState);

  const derivation = pickCandidateWithFallback(rng, state, chosenCandidateIds, pools, (candidate) => candidate.bucket === 'derivation');
  chosenCandidateIds.add(derivation.bankQuestionId);
  candidates.push(derivation);

  const backpropAuto = pickCandidateWithFallback(
    rng,
    state,
    chosenCandidateIds,
    pools,
    (candidate) => candidate.bucket === 'backprop_auto'
  );
  chosenCandidateIds.add(backpropAuto.bankQuestionId);
  candidates.push(backpropAuto);

  const cnnAuto = pickCandidateWithFallback(
    rng,
    state,
    chosenCandidateIds,
    pools,
    (candidate) => candidate.bucket === 'cnn_auto'
  );
  chosenCandidateIds.add(cnnAuto.bankQuestionId);
  candidates.push(cnnAuto);

  const concept = pickCandidateWithFallback(rng, state, chosenCandidateIds, pools, (candidate) => candidate.bucket === 'concept');
  chosenCandidateIds.add(concept.bankQuestionId);
  candidates.push(concept);

  while (candidates.length < SESSION_QUESTION_COUNT) {
    const extraCandidate = pickCandidateWithFallback(rng, state, chosenCandidateIds, pools, () => true);
    chosenCandidateIds.add(extraCandidate.bankQuestionId);
    candidates.push(extraCandidate);
  }

  return shuffle(rng, candidates).map((candidate) => candidate.materialize(rng, slotId));
}

export function getQuestionBankCoverage(): TopicTag[] {
  return [...new Set(QUESTION_TEMPLATES.map((template) => template.topicTag))];
}
