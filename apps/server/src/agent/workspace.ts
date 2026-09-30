import type { BookFileKind, StoryOptions } from '@worldbookllm/shared';

import type { BookService } from '../services/books.js';
import type { CheckpointSession } from '../story/checkpoints.js';
import type { StoryRunResult } from '../story/story-cli.js';
import type { StoryCommandName } from '../story/story-commands.js';

/**
 * The book an agent turn works on. Normally that is the book itself, with
 * every change gathered into the turn's checkpoint session; in review mode
 * it is a staged copy (`StagedBook`) whose changes are proposed instead.
 */
export interface AgentWorkspace {
  readFile(path: string): { path: string; hash: string; content: string };
  listFiles(): Array<{ path: string; kind: BookFileKind; title: string }>;
  search(query: string): Array<{ path: string; title: string; excerpt: string }>;
  writeFile(path: string, content: string, expectedHash: string | null): Promise<void>;
  editFile(path: string, find: string, replace: string): Promise<void>;
  runStory(
    command: StoryCommandName,
    args: string[],
    options: StoryOptions,
  ): Promise<StoryRunResult>;
}

/** The real book, with writes captured in the turn's checkpoint session. */
export class LiveWorkspace implements AgentWorkspace {
  constructor(
    private readonly books: BookService,
    private readonly session: CheckpointSession,
  ) {}

  readFile(path: string) {
    const file = this.books.readFile(this.session.book, path);
    return { path: file.path, hash: file.hash, content: file.content };
  }

  listFiles() {
    return this.books.listFiles(this.session.book);
  }

  search(query: string) {
    return this.books.search(this.session.book, query);
  }

  writeFile(path: string, content: string, expectedHash: string | null) {
    return this.books.writeInSession(this.session, path, content, expectedHash);
  }

  editFile(path: string, find: string, replace: string) {
    return this.books.editInSession(this.session, path, find, replace);
  }

  runStory(command: StoryCommandName, args: string[], options: StoryOptions) {
    return this.books.runStoryForAgent(this.session, command, args, options);
  }
}
