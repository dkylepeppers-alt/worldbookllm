import type { ChapterEnding, ClosingChoice } from '@worldbookllm/shared';

import { inkText } from './format.js';

/**
 * The end of an ink chapter as the choices screen edits it (ADR 0030): a
 * run of top-level choices, each `* {condition} [text]` with optional `~`
 * lines and a divert, or one divert when the chapter has no choices. Any
 * other ending is ink the screen leaves to the editor.
 */

const TARGET = String.raw`[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?`;
const CHOICE = new RegExp(
  String.raw`^([*+])[ \t]*(?:\{([^{}]*)\}[ \t]*)?\[((?:\\.|[^\]\\])*)\][ \t]*(?:->[ \t]*(${TARGET}))?[ \t]*$`,
  'u',
);
const EFFECT = /^[ \t]+~[ \t]*(.+?)[ \t]*$/u;
const INDENTED_DIVERT = new RegExp(String.raw`^[ \t]+->[ \t]*(${TARGET})[ \t]*$`, 'u');
const DIVERT = new RegExp(String.raw`^->[ \t]*(${TARGET})[ \t]*$`, 'u');

export interface ReadEnding {
  editable: boolean;
  reason: string | null;
  ending: ChapterEnding;
  /** The body before the ending, without trailing blank lines. */
  before: string;
}

function unescape(text: string): string {
  return text.replace(/\\(.)/gu, '$1');
}

/** Reads a chapter body's ending; `before` is everything ahead of it. */
export function readEnding(body: string): ReadEnding {
  const lines = body.replace(/\r\n?/gu, '\n').split('\n');
  while (lines.length > 0 && lines.at(-1)!.trim() === '') lines.pop();
  const plain = (then: string, end: number): ReadEnding => ({
    editable: true,
    reason: null,
    ending: { choices: [], then },
    before: lines.slice(0, end).join('\n').trimEnd(),
  });
  const refuse = (reason: string): ReadEnding => ({
    editable: false,
    reason,
    ending: { choices: [], then: 'END' },
    before: body,
  });

  const last = lines.at(-1);
  if (last === undefined) return plain('END', 0);
  const divert = DIVERT.exec(last);
  if (divert !== null) {
    const previous = lines.slice(0, -1).findLast((line) => line.trim() !== '');
    if (previous !== undefined && /^\s*[*+]|^\s/u.test(previous)) {
      return refuse('The chapter ends with a divert after its choices; edit its ending as ink.');
    }
    return plain(divert[1]!, lines.length - 1);
  }

  // The run of choice, effect, and divert lines at the end, read backwards.
  let start = lines.length;
  while (start > 0) {
    const line = lines[start - 1]!;
    if (
      line.trim() === '' ||
      CHOICE.test(line) ||
      EFFECT.test(line) ||
      INDENTED_DIVERT.test(line)
    ) {
      start -= 1;
    } else break;
  }
  while (start < lines.length && !CHOICE.test(lines[start]!)) start += 1;
  if (start === lines.length) {
    if (/^\s*[*+]/u.test(last) || /^\s/u.test(last)) {
      return refuse('The chapter ends inside a weave of choices; edit its ending as ink.');
    }
    // Prose to the end: the story would run out here, so the form adds an ending.
    return plain('END', lines.length);
  }
  const previous = lines.slice(0, start).findLast((line) => line.trim() !== '');
  if (previous !== undefined && (/^\s*[*+]/u.test(previous) || /^\s/u.test(previous))) {
    return refuse('These choices are part of a larger weave; edit them as ink.');
  }

  const choices: ClosingChoice[] = [];
  for (const line of lines.slice(start)) {
    if (line.trim() === '') continue;
    const choice = CHOICE.exec(line);
    if (choice !== null) {
      choices.push({
        text: unescape(choice[3]!).trim(),
        once: choice[1] === '*',
        condition: choice[2]?.trim() ?? '',
        effects: [],
        to: choice[4] ?? '',
      });
      continue;
    }
    const current = choices.at(-1)!;
    const effect = EFFECT.exec(line);
    if (effect !== null && current.to === '') {
      current.effects.push(effect[1]!);
      continue;
    }
    const onward = INDENTED_DIVERT.exec(line);
    if (onward !== null && current.to === '') {
      current.to = onward[1]!;
      continue;
    }
    return refuse('A choice has lines after its divert; edit its ending as ink.');
  }
  if (choices.some((choice) => choice.to === '')) {
    return refuse('A choice does not divert anywhere; edit its ending as ink.');
  }
  return {
    editable: true,
    reason: null,
    ending: { choices, then: 'END' },
    before: lines.slice(0, start).join('\n').trimEnd(),
  };
}

/** A closing choice as ink lines. */
export function choiceLines(choice: ClosingChoice): string[] {
  const head = `${choice.once ? '*' : '+'} ${choice.condition.trim() === '' ? '' : `{${choice.condition.trim()}} `}[${inkText(choice.text.trim())}]`;
  if (choice.effects.length === 0) return [`${head} -> ${choice.to}`];
  return [head, ...choice.effects.map((effect) => `    ~ ${effect.trim()}`), `    -> ${choice.to}`];
}

/** The chapter body with its ending replaced. */
export function writeEnding(before: string, ending: ChapterEnding): string {
  const block =
    ending.choices.length === 0
      ? [`-> ${ending.then}`]
      : ending.choices.flatMap((choice) => choiceLines(choice));
  return `${before.trimEnd() === '' ? '' : `${before.trimEnd()}\n\n`}${block.join('\n')}\n`;
}
