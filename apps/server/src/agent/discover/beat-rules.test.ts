import { describe, expect, it } from 'vitest';

import {
  WRITING_EXAMPLES,
  acceptActionArgs,
  checkBeat,
  checkChoices,
  choiceFromArgs,
  declineActionArgs,
  writeBeatArgs,
  writeChoicesArgs,
} from './beat-rules.js';

describe('the writing tools’ examples', () => {
  it('are valid arguments, since models copy them', () => {
    const schemas = {
      write_beat: writeBeatArgs,
      write_choices: writeChoicesArgs,
      accept_action: acceptActionArgs,
      decline_action: declineActionArgs,
    };
    for (const [name, example] of Object.entries(WRITING_EXAMPLES)) {
      const parsed = schemas[name as keyof typeof schemas].safeParse(JSON.parse(example));
      expect(parsed.success, `${name}: ${parsed.error?.message ?? ''}`).toBe(true);
    }
  });

  it('read a chapter id given as where a choice leads as rejoining it', () => {
    const parsed = writeChoicesArgs.parse({
      choices: [{ text: 'Go back', intent: 'retreat', leads_to: 'chapter-04' }],
    });
    expect(parsed.choices[0]).toMatchObject({ leads_to: 'existing', chapter: 'chapter-04' });
  });

  it('say how to fix a rejoin that names no chapter, or one that does not exist', () => {
    const context = {
      count: 1,
      variables: new Set<string>(),
      chapters: new Set(['chapter-04']),
      knots: new Set<string>(),
      self: 'chapter-02',
    };
    const choice = (chapter: string) =>
      choiceFromArgs({
        text: 'Go back',
        intent: 'retreat',
        consequence: 'the night is lost',
        condition: '',
        effects: [],
        leads_to: 'existing',
        chapter,
        note: '',
      });
    expect(checkChoices([choice('')], context)).toEqual([
      'Choice 1 ("Go back") rejoins without saying where: give "chapter" (an id from Beats a choice could rejoin, like "chapter-04"), or lead to "new".',
    ]);
    expect(checkChoices([choice('chapter-99')], context)[0]).toContain(
      'Use an id from Beats a choice could rejoin',
    );
  });

  it('do not let a rewrite end the story where its choices lead to written beats', () => {
    const ending = {
      title: 'The end',
      summary: '',
      ink: 'She sat down.',
      ending: true,
      choices: [],
    };
    const context = {
      count: 3,
      variables: new Set<string>(),
      chapters: new Set<string>(),
      knots: new Set<string>(),
      self: 'chapter-02',
    };
    expect(checkBeat(ending, { ...context, keepTargets: ['existing:chapter-05'] })).toEqual([
      "Keep this beat's choices: the beats after them are already written, so it cannot become an ending.",
    ]);
    expect(checkBeat(ending, context)).toEqual([]);
  });
});
