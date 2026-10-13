import { describe, expect, it } from 'vitest';

import {
  WRITING_EXAMPLES,
  acceptActionArgs,
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
});
