import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { STORY_COMMANDS } from './story-commands.js';

interface UpstreamCommand {
  name: string;
  project: string;
  args?: number;
  options?: string[];
}

interface UpstreamOption {
  name: string;
  value?: string;
  repeatable?: boolean;
}

async function loadUpstream(): Promise<{ commands: UpstreamCommand[]; options: UpstreamOption[] }> {
  const root = dirname(createRequire(import.meta.url).resolve('story-skills/package.json'));
  const commandsUrl = pathToFileURL(join(root, 'src', 'commands.js')).href;
  const optionsUrl = pathToFileURL(join(root, 'src', 'options.js')).href;
  const commandsModule = (await import(commandsUrl)) as { COMMANDS: UpstreamCommand[] };
  const optionsModule = (await import(optionsUrl)) as { OPTIONS: UpstreamOption[] };
  return { commands: commandsModule.COMMANDS, options: optionsModule.OPTIONS };
}

describe('vendored story command table', () => {
  it('matches the pinned story-skills COMMANDS and OPTIONS exactly', async () => {
    const { commands, options } = await loadUpstream();
    const optionByName = new Map(options.map((option) => [option.name, option]));
    const upstream = Object.fromEntries(
      commands.map((command) => [
        command.name,
        {
          project: command.project,
          maxArgs:
            command.args === Infinity
              ? null
              : (command.args ?? (command.project === 'positional' ? 1 : 0)),
          options: Object.fromEntries(
            (command.options ?? []).map((name) => {
              const option = optionByName.get(name);
              return [
                name,
                { value: option?.value !== undefined, repeatable: Boolean(option?.repeatable) },
              ];
            }),
          ),
        },
      ]),
    );
    expect(STORY_COMMANDS).toEqual(upstream);
  });
});
