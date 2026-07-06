import yaml from 'yaml';

import { ExtractedTextChunk } from './types';

export type MarkdownQuestionRecord = Record<string, unknown> & {
  citations: Array<Record<string, unknown>>;
};

export type MarkdownParseError = {
  blockIndex: number;
  message: string;
};

export type MarkdownParseResult = {
  questions: MarkdownQuestionRecord[];
  chunks: ExtractedTextChunk[];
  parseErrors: MarkdownParseError[];
};

const SEPARATOR_REGEX = /^---\s*$/;
const HEADING_REGEX = /^##\s+(.+?)\s*$/;
// CommonMark allows fenced code blocks to be indented by up to 3 spaces.
const FENCE_OPEN_REGEX = /^ {0,3}(```+|~~~+)/;
const FENCE_CLOSE_LEADING_SPACE_REGEX = /^ {0,3}/;
const FENCE_CLOSE_TAIL_REGEX = /^[`~]+\s*$/;

function isFenceCloser(line: string, fenceMarker: string): boolean {
  const trimmed = line.replace(FENCE_CLOSE_LEADING_SPACE_REGEX, '');
  return trimmed.startsWith(fenceMarker) && FENCE_CLOSE_TAIL_REGEX.test(trimmed);
}

// Split on `---` lines, but ignore them while inside a fenced code block so a
// YAML/code sample embedded in a stem or worked solution doesn't masquerade
// as a question separator. Thematic breaks outside fences are still treated
// as separators — authors who need a real thematic break inside a body should
// use `***` or `___` instead.
function splitBySeparator(source: string): string[] {
  const lines = source.split(/\r?\n/);
  const segments: string[] = [];
  let current: string[] = [];
  let fenceMarker: string | null = null;
  for (const line of lines) {
    if (fenceMarker === null) {
      const fenceMatch = FENCE_OPEN_REGEX.exec(line);
      if (fenceMatch) {
        fenceMarker = fenceMatch[1] ?? null;
        current.push(line);
        continue;
      }
      if (SEPARATOR_REGEX.test(line)) {
        segments.push(current.join('\n'));
        current = [];
        continue;
      }
      current.push(line);
    } else {
      current.push(line);
      if (isFenceCloser(line, fenceMarker)) {
        fenceMarker = null;
      }
    }
  }
  segments.push(current.join('\n'));
  return segments;
}

function trimMultiline(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

type BodySections = {
  stem?: string;
  hint?: string;
  workedSolution?: string;
};

function extractBodySections(body: string): BodySections {
  const lines = body.split(/\r?\n/);
  const sections: { stem: string[]; hint: string[]; workedSolution: string[] } = {
    stem: [],
    hint: [],
    workedSolution: []
  };
  let currentKey: keyof typeof sections | null = null;
  let fenceMarker: string | null = null;
  let recognizedHeadingSeen = false;

  for (const line of lines) {
    if (fenceMarker === null) {
      const fenceMatch = FENCE_OPEN_REGEX.exec(line);
      if (fenceMatch) {
        fenceMarker = fenceMatch[1] ?? null;
        if (currentKey) {
          sections[currentKey].push(line);
        }
        continue;
      }
      const headingMatch = HEADING_REGEX.exec(line);
      if (headingMatch) {
        const normalized = (headingMatch[1] ?? '').trim().toLowerCase();
        if (normalized === 'stem' || normalized === 'question' || normalized === 'prompt') {
          currentKey = 'stem';
          recognizedHeadingSeen = true;
        } else if (normalized === 'hint') {
          currentKey = 'hint';
          recognizedHeadingSeen = true;
        } else if (normalized === 'worked solution' || normalized === 'solution' || normalized === 'answer explanation') {
          currentKey = 'workedSolution';
          recognizedHeadingSeen = true;
        } else {
          currentKey = null;
        }
        continue;
      }
      if (currentKey) {
        sections[currentKey].push(line);
      }
    } else {
      if (currentKey) {
        sections[currentKey].push(line);
      }
      if (isFenceCloser(line, fenceMarker)) {
        fenceMarker = null;
      }
    }
  }

  // If the author wrote a body with no recognized section headings, treat the
  // whole body as the stem. Otherwise valid free-form questions would fail
  // validation purely because they didn't use `## Stem`.
  if (!recognizedHeadingSeen) {
    return { stem: trimMultiline(body) };
  }

  return {
    stem: trimMultiline(sections.stem.join('\n')),
    hint: trimMultiline(sections.hint.join('\n')),
    workedSolution: trimMultiline(sections.workedSolution.join('\n'))
  };
}

function pickString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseMarkdownQuestions(
  fileContents: string,
  options: { defaultSource?: string; documentId?: string; documentName?: string } = {}
): MarkdownParseResult {
  // Strip a leading UTF-8 BOM so editors that save with one (e.g. Notepad) don't
  // glue the BOM onto the first `---` line and defeat the separator regex.
  const normalized = fileContents.charCodeAt(0) === 0xfeff ? fileContents.slice(1) : fileContents;
  const segments = splitBySeparator(normalized);
  while (segments.length > 0 && (segments[0] ?? '').trim().length === 0) {
    segments.shift();
  }
  while (segments.length > 0 && (segments[segments.length - 1] ?? '').trim().length === 0) {
    segments.pop();
  }

  const questions: MarkdownQuestionRecord[] = [];
  const chunks: ExtractedTextChunk[] = [];
  const parseErrors: MarkdownParseError[] = [];
  const documentId = options.documentId ?? '';
  const documentName = options.documentName ?? '';

  let questionNumber = 0;
  let i = 0;
  while (i < segments.length) {
    const yamlSegment = segments[i] ?? '';
    // A blank YAML position usually means the user typed two `---` lines in a row
    // or left a stray separator. Skip without error so the rest of the file stays aligned.
    if (yamlSegment.trim().length === 0) {
      i += 1;
      continue;
    }
    const bodySegment = segments[i + 1] ?? '';
    i += 2;
    questionNumber += 1;

    let frontmatter: Record<string, unknown>;
    try {
      const parsed = yaml.parse(yamlSegment);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Frontmatter must be a YAML mapping.');
      }
      frontmatter = parsed as Record<string, unknown>;
    } catch (error) {
      parseErrors.push({
        blockIndex: questionNumber,
        message: error instanceof Error
          ? `Question ${questionNumber} frontmatter is invalid: ${error.message}`
          : `Question ${questionNumber} frontmatter is invalid.`
      });
      continue;
    }

    const body = extractBodySections(bodySegment);
    const stem = pickString(frontmatter, 'stem') ?? body.stem ?? '';
    const hint = pickString(frontmatter, 'hint') ?? body.hint;
    const workedSolution = pickString(frontmatter, 'workedSolution') ?? body.workedSolution ?? '';
    const title = pickString(frontmatter, 'title') ?? '';
    const source = pickString(frontmatter, 'source') ?? options.defaultSource ?? '';

    const chunkId = `question-${questionNumber}`;
    const locatorLabel = title ? `Question ${questionNumber}: ${title}` : `Question ${questionNumber}`;
    const chunkText = [stem, workedSolution].filter((part) => part.length > 0).join('\n\n') || bodySegment.trim() || title || locatorLabel;
    chunks.push({
      id: chunkId,
      order: questionNumber,
      text: chunkText,
      locatorLabel
    });

    const excerpt = (stem || title || locatorLabel).slice(0, 240);
    const citation: Record<string, unknown> = {
      documentId,
      documentName,
      chunkId,
      locatorLabel,
      excerpt
    };

    const answerSchema = frontmatter.answerSchema ?? frontmatter.answer;

    questions.push({
      title,
      source,
      topicId: pickString(frontmatter, 'topicId') ?? '',
      topicLabel: pickString(frontmatter, 'topicLabel') ?? '',
      difficulty: frontmatter.difficulty,
      promptType: frontmatter.promptType,
      selectionBucket: frontmatter.selectionBucket,
      stem,
      hint,
      workedSolution,
      answerSchema,
      citations: [citation]
    });
  }

  return { questions, chunks, parseErrors };
}
