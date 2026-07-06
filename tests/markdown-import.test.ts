import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createDefaultQuestionBankState,
  getExtractedTextDir,
  getManagedDocumentsDir,
  importMarkdownQuestionFile,
  publishDraftsInQuestionBank
} from '../src/shared/question-bank-storage';
import { parseMarkdownQuestions } from '../src/shared/markdown-questions';

const TWO_QUESTION_DOC = `---
title: Conv2d output size
topicId: cnn-shapes
topicLabel: CNN shapes
source: Lecture 4 notes
difficulty: medium
promptType: numeric
selectionBucket: cnn_auto
answer:
  kind: numeric
  correctValue: 26
  tolerance: 0
  unitLabel: cells
---
## Stem
Given a 28x28 input, 3x3 kernel, stride 1, no padding, what is the output size?

## Hint
Use floor((W - K + 2P) / S) + 1.

## Worked solution
floor((28 - 3 + 0) / 1) + 1 = 26.
---
title: Sigmoid derivative
topicId: activations
topicLabel: Activation derivatives
difficulty: medium
promptType: structured
selectionBucket: backprop_auto
answer:
  kind: structured
  acceptableAnswers:
    - sigma(x) * (1 - sigma(x))
---
## Stem
What is the derivative of the sigmoid function?

## Worked solution
d/dx sigma(x) = sigma(x) * (1 - sigma(x)).
---
`;

function makeNow(): Date {
  return new Date('2026-05-09T10:00:00.000Z');
}

describe('parseMarkdownQuestions', () => {
  it('splits a multi-question file into per-question records and chunks', () => {
    const result = parseMarkdownQuestions(TWO_QUESTION_DOC, { defaultSource: 'lectures.md' });
    expect(result.parseErrors).toEqual([]);
    expect(result.questions).toHaveLength(2);
    expect(result.chunks).toHaveLength(2);

    expect(result.chunks[0]?.id).toBe('question-1');
    expect(result.chunks[0]?.locatorLabel).toBe('Question 1: Conv2d output size');
    expect(result.chunks[0]?.text).toContain('Given a 28x28 input');
    expect(result.chunks[0]?.text).toContain('floor((28 - 3 + 0)');

    const firstCitation = result.questions[0]?.citations[0];
    expect(firstCitation?.chunkId).toBe('question-1');
    expect(firstCitation?.locatorLabel).toBe('Question 1: Conv2d output size');
    expect(firstCitation?.documentId).toBe('');
    expect(firstCitation?.documentName).toBe('');

    expect(result.questions[0]?.title).toBe('Conv2d output size');
    expect(result.questions[0]?.promptType).toBe('numeric');
    expect(result.questions[0]?.stem).toContain('28x28 input');
    expect(result.questions[0]?.workedSolution).toContain('floor');
    expect(result.questions[0]?.hint).toContain('floor');
    expect(result.questions[0]?.source).toBe('Lecture 4 notes');

    expect(result.questions[1]?.source).toBe('lectures.md');
    expect(result.questions[1]?.promptType).toBe('structured');
  });

  it('skips stray empty separators without producing parse errors or shifting alignment', () => {
    const withStraySeparators = `---
---
title: First
topicId: t1
topicLabel: Topic one
promptType: structured
selectionBucket: concept
answer:
  kind: structured
  acceptableAnswers:
    - alpha
---
## Stem
First stem.

## Worked solution
First solution.
---
---
title: Second
topicId: t2
topicLabel: Topic two
promptType: structured
selectionBucket: concept
answer:
  kind: structured
  acceptableAnswers:
    - beta
---
## Stem
Second stem.

## Worked solution
Second solution.
---
`;
    const result = parseMarkdownQuestions(withStraySeparators);
    expect(result.parseErrors).toEqual([]);
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0]?.title).toBe('First');
    expect(result.questions[1]?.title).toBe('Second');
  });

  it('treats an unheaded body as the stem so authors can omit ## Stem', () => {
    const noHeadings = `---
title: Plain prose
topicId: prose
topicLabel: Prose
promptType: structured
selectionBucket: concept
workedSolution: The answer.
answer:
  kind: structured
  acceptableAnswers:
    - answer
---
What is the answer to the question written as plain prose
without any explicit section headings?
---
`;
    const result = parseMarkdownQuestions(noHeadings);
    expect(result.parseErrors).toEqual([]);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.stem).toContain('What is the answer');
    expect(result.questions[0]?.stem).toContain('plain prose');
    expect(result.questions[0]?.workedSolution).toBe('The answer.');
  });

  it('treats indented fenced code blocks as fences so indented --- is not a separator', () => {
    const indentedFence = `---
title: Indented fence
topicId: fences
topicLabel: Fences
promptType: structured
selectionBucket: concept
answer:
  kind: structured
  acceptableAnswers:
    - alpha
---
## Stem
Here is an indented fenced block (3 spaces):

   \`\`\`yaml
   ---
   key: value
   ---
   \`\`\`

## Worked solution
Indented fences should still hide the inner triple-dashes.
---
`;
    const result = parseMarkdownQuestions(indentedFence);
    expect(result.parseErrors).toEqual([]);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.stem).toContain('key: value');
  });

  it('does not split on --- lines inside a fenced code block', () => {
    const withFencedSeparator = `---
title: YAML example
topicId: yaml
topicLabel: YAML
promptType: structured
selectionBucket: concept
answer:
  kind: structured
  acceptableAnswers:
    - alpha
---
## Stem
Consider the following frontmatter:
\`\`\`yaml
---
key: value
---
\`\`\`

## Worked solution
The triple-dashes inside the code fence are part of the example.
---
`;
    const result = parseMarkdownQuestions(withFencedSeparator);
    expect(result.parseErrors).toEqual([]);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.stem).toContain('---');
    expect(result.questions[0]?.stem).toContain('key: value');
    expect(result.questions[0]?.workedSolution).toContain('triple-dashes');
  });

  it('ignores section-heading lookalikes inside a fenced code block in the body', () => {
    const fakeHeadingInside = `---
title: Heading inside fence
topicId: fences
topicLabel: Fences
promptType: structured
selectionBucket: concept
answer:
  kind: structured
  acceptableAnswers:
    - ok
---
## Stem
Here is some code that mentions worked solution textually:
\`\`\`
## Worked solution
not really a section heading
\`\`\`
After the fence, still in the stem.

## Worked solution
The actual worked solution.
---
`;
    const result = parseMarkdownQuestions(fakeHeadingInside);
    expect(result.parseErrors).toEqual([]);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.stem).toContain('not really a section heading');
    expect(result.questions[0]?.stem).toContain('After the fence');
    expect(result.questions[0]?.workedSolution).toBe('The actual worked solution.');
  });

  it('strips a leading UTF-8 BOM so the first separator still matches', () => {
    const withBom = '﻿' + TWO_QUESTION_DOC;
    const result = parseMarkdownQuestions(withBom);
    expect(result.parseErrors).toEqual([]);
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0]?.title).toBe('Conv2d output size');
  });

  it('threads documentId and documentName into citation stubs when provided', () => {
    const result = parseMarkdownQuestions(TWO_QUESTION_DOC, {
      defaultSource: 'lectures.md',
      documentId: 'doc-xyz',
      documentName: 'lectures.md'
    });
    expect(result.questions[0]?.citations[0]?.documentId).toBe('doc-xyz');
    expect(result.questions[0]?.citations[0]?.documentName).toBe('lectures.md');
  });

  it('records a parse error for a malformed YAML block but keeps other questions', () => {
    const malformed = `---
title: Broken
difficulty: medium
promptType: : not-yaml-:
---
## Stem
This block should not parse cleanly.
---
title: Working
topicId: ok
topicLabel: OK topic
promptType: structured
selectionBucket: concept
answer:
  kind: structured
  acceptableAnswers:
    - works
---
## Stem
This block parses.

## Worked solution
Yes.
---
`;
    const result = parseMarkdownQuestions(malformed);
    expect(result.parseErrors).toHaveLength(1);
    expect(result.parseErrors[0]?.blockIndex).toBe(1);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.title).toBe('Working');
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.id).toBe('question-2');
    expect(result.questions[0]?.citations[0]?.chunkId).toBe('question-2');
  });
});

describe('importMarkdownQuestionFile', () => {
  function setupTempUserData(): { userDataDir: string; mdPath: string; fileName: string } {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calctrainer-md-'));
    const userDataDir = path.join(tempDir, 'user-data');
    const mdPath = path.join(tempDir, 'questions.md');
    return { userDataDir, mdPath, fileName: 'questions.md' };
  }

  it('registers the markdown file as a document, saves chunks, and turns each question into a draft', async () => {
    const { userDataDir, mdPath, fileName } = setupTempUserData();
    fs.writeFileSync(mdPath, TWO_QUESTION_DOC, 'utf8');

    const initial = createDefaultQuestionBankState(makeNow());
    const result = await importMarkdownQuestionFile(initial, mdPath, userDataDir, makeNow());

    expect(result.unsupported).toBe(false);
    expect(result.duplicate).toBe(false);
    expect(result.draftCount).toBe(2);
    expect(result.validDraftCount).toBe(2);
    expect(result.parseErrorCount).toBe(0);
    expect(result.batchId).toBeDefined();

    expect(result.state.documents).toHaveLength(1);
    const document = result.state.documents[0]!;
    expect(document.kind).toBe('markdown');
    expect(document.fileName).toBe(fileName);
    expect(document.extractionStatus).toBe('ready');
    expect(document.chunkCount).toBe(2);

    expect(fs.existsSync(path.join(getManagedDocumentsDir(userDataDir), document.storedFileName))).toBe(true);
    expect(fs.existsSync(path.join(getExtractedTextDir(userDataDir), document.extractedTextFileName!))).toBe(true);

    expect(result.state.batches).toHaveLength(1);
    expect(result.state.batches[0]?.generationMode).toBe('markdown_import');
    expect(result.state.batches[0]?.status).toBe('drafts_ready');

    expect(result.state.drafts).toHaveLength(2);
    for (const draft of result.state.drafts) {
      expect(draft.validationIssues).toEqual([]);
      expect(draft.citations[0]?.documentId).toBe(document.id);
      expect(draft.citations[0]?.documentName).toBe(fileName);
      expect(draft.citations[0]?.chunkId).toMatch(/^question-\d+$/);
    }
  });

  it('publishes valid drafts produced by the markdown import via the existing publish flow', async () => {
    const { userDataDir, mdPath } = setupTempUserData();
    fs.writeFileSync(mdPath, TWO_QUESTION_DOC, 'utf8');

    const importResult = await importMarkdownQuestionFile(
      createDefaultQuestionBankState(makeNow()),
      mdPath,
      userDataDir,
      makeNow()
    );
    const draftIds = importResult.state.drafts.map((draft) => draft.id);

    const published = publishDraftsInQuestionBank(importResult.state, draftIds, makeNow());
    expect(published.publishedCount).toBe(2);
    expect(published.skippedCount).toBe(0);
    expect(published.state.publishedQuestions).toHaveLength(2);
    for (const question of published.state.publishedQuestions) {
      expect(question.citations[0]?.chunkId).toMatch(/^question-\d+$/);
      expect(question.origin).toBe('generated');
    }
  });

  it('flags a draft with a derivation/concept bucket mismatch as needing attention', async () => {
    const { userDataDir, mdPath } = setupTempUserData();
    const conflicting = `---
title: Show derivation
topicId: bp
topicLabel: Backprop
promptType: derivation
selectionBucket: concept
answer:
  kind: derivation
  checklist:
    - Compute dL/dz
    - Apply chain rule
---
## Stem
Derive the gradient of the loss with respect to the pre-activation z.

## Worked solution
dL/dz = (a - y) for sigmoid + BCE.
---
`;
    fs.writeFileSync(mdPath, conflicting, 'utf8');

    const result = await importMarkdownQuestionFile(
      createDefaultQuestionBankState(makeNow()),
      mdPath,
      userDataDir,
      makeNow()
    );
    expect(result.draftCount).toBe(1);
    expect(result.validDraftCount).toBe(0);
    const draft = result.state.drafts[0]!;
    expect(draft.validationIssues.some((issue) => issue.field === 'selectionBucket')).toBe(true);
    expect(result.state.batches[0]?.status).toBe('partial_error');
  });

  it('rejects unsupported file extensions', async () => {
    const { userDataDir, mdPath } = setupTempUserData();
    const txtPath = mdPath.replace(/\.md$/, '.txt');
    fs.writeFileSync(txtPath, TWO_QUESTION_DOC, 'utf8');

    const result = await importMarkdownQuestionFile(
      createDefaultQuestionBankState(makeNow()),
      txtPath,
      userDataDir,
      makeNow()
    );
    expect(result.unsupported).toBe(true);
    expect(result.draftCount).toBe(0);
    expect(result.state.documents).toHaveLength(0);
  });

  it('detects duplicate imports by checksum', async () => {
    const { userDataDir, mdPath } = setupTempUserData();
    fs.writeFileSync(mdPath, TWO_QUESTION_DOC, 'utf8');

    const first = await importMarkdownQuestionFile(
      createDefaultQuestionBankState(makeNow()),
      mdPath,
      userDataDir,
      makeNow()
    );
    const second = await importMarkdownQuestionFile(first.state, mdPath, userDataDir, makeNow());
    expect(second.duplicate).toBe(true);
    expect(second.draftCount).toBe(0);
    expect(second.state.documents).toHaveLength(1);
  });
});
