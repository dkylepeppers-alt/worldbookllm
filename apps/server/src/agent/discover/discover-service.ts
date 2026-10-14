import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import { supportsTools } from '@worldbookllm/providers';
import {
  discoverVariableSchema,
  isBeatWriterSkill,
  storyDraftSchema,
  type BeatDraft,
  type CustomAgent,
  type DiscoverJob,
  type DiscoverSetup,
  type DiscoverState,
  type DiscoverVariable,
  type DraftBeatInput,
  type PlayPosition,
  type ProposalDecision,
  type ProposeStoryInput,
  type ProposeVariablesInput,
  type SaveDiscoverSetupInput,
  type SomethingElseInput,
  type StoryDraft,
  type VariableProposal,
  type WriteBeatInput,
} from '@worldbookllm/shared';

import { ConfigurationError, ConflictError, NotFoundError, ValidationError } from '../../errors.js';
import type { BookService, DiscoverFiles } from '../../services/books.js';
import type { SkillService } from '../../services/skills.js';
import type { CustomAgentService } from '../custom-agents.js';
import { truncateResult } from '../agent-service.js';
import type { AgentToolRegistry } from '../tools.js';
import type { ProviderService } from '../../services/providers.js';
import type { SettingsService } from '../../services/settings.js';
import { parseFrontmatter } from '../../story/book-index.js';
import {
  RULES_FILE,
  SETUP_FILE,
  beatFiles,
  choicesFiles,
  discoverBeats,
  leadFrontier,
  looseVariable,
  markReviewed,
  nextChapterNumber,
  readRules,
  readSetup,
  readVariables,
  rulesFile,
  seedChapter,
  setupFile,
  withAddedChoice,
  withKernel,
  withSeedNote,
  withVariables,
  type BeatChoice,
  type BeatFiles,
  type BeatProposal,
  type DiscoverChapter,
  type FrontierItem,
} from '../../story/interactive/discover.js';
import { readEnding } from '../../story/interactive/ending.js';
import { INK_VARIABLES_FILE, inkKnotName, inkSection } from '../../story/interactive/format.js';
import { markdownToInk } from '../../story/interactive/markdown-to-ink.js';
import { projectInk } from '../../story/interactive/projection.js';
import {
  replayPosition,
  transcriptText,
  type ReplayedPosition,
} from '../../story/interactive/replay.js';
import { googleModelWithoutTools, streamStep } from '../provider-step.js';
import {
  beatSystemPrompt,
  beatTaskPrompt,
  reviewPrompt,
  type BeatPromptInput,
  type BeatRole,
} from './beat-prompt.js';
import {
  checkBeat,
  checkChoices,
  choiceFromArgs,
  describeChoices,
  proposalFromArgs,
  type BeatToolName,
  type ChoiceCheckContext,
} from './beat-rules.js';
import {
  BeatWriterError,
  reviewChoices,
  runBeatWriter,
  type BeatHandlers,
  type HandlerOutcome,
  type ModelAccess,
} from './beat-writer.js';
import { readJsonReply } from './model-json.js';

/**
 * Discovery (ADR 0033): the story setup, the beat writer's jobs, and lead
 * mode, which keeps the beats after the reader written. Jobs run one at a
 * time per book, in memory; what they write is ordinary book files, each
 * beat its own checkpoint.
 */

const START: PlayPosition = { from: null, set: {}, seed: 1, path: [] };
/** Review rejections before a set that passes the structural checks is written anyway, with the notes kept. */
const REVIEW_ROUNDS = 2;
const DRAFT_COUNT = 3;
const BIBLE_KINDS = new Set(['character', 'location', 'system', 'faction', 'artifact', 'term']);
const BIBLE_BUDGET = 20_000;
const ENTRY_BUDGET = 3_000;
const KEEP_FINISHED = 20;
/** Prose from the written scenes a drafted story setup reads. */
const SCENES_BUDGET = 10_000;
/** Text from the skills an agent names that comes loaded on every beat; the rest are listed to load. */
const NAMED_SKILLS_BUDGET = 48_000;

type Task =
  | { kind: 'beat'; chapterId: string; position: PlayPosition | null; direction: string | null }
  | { kind: 'choices'; chapterId: string; position: PlayPosition | null }
  | {
      kind: 'rewrite';
      chapterId: string;
      position: PlayPosition | null;
      direction: string | null;
      /** Asked for by the writer, so it runs even on a beat they read or edited. */
      force: boolean;
    }
  | { kind: 'drafts'; chapterId: string; position: PlayPosition | null; direction: string | null }
  | { kind: 'something-else'; position: PlayPosition; action: string; force: boolean }
  | { kind: 'variables'; kernel: string; shape: string }
  | { kind: 'story'; draft: ProposeStoryInput };

interface JobRecord {
  job: DiscoverJob;
  task: Task;
  /** Queued by lead mode, so dropped when the reader moves away. */
  lead: boolean;
  controller: AbortController | null;
  /** A drafts job's proposals, by draft id. */
  proposals: Map<string, BeatProposal>;
}

interface BookJobs {
  records: JobRecord[];
  running: boolean;
  position: PlayPosition | null;
}

interface ProposalRow {
  id: string;
  book: string;
  name: string;
  initial: string;
  meaning: string;
  reason: string;
  chapter_id: string | null;
  created_at: string;
}

function chapterOf(files: DiscoverFiles, id: string): DiscoverChapter {
  const chapter = files.chapters.find((entry) => entry.id === id);
  if (chapter === undefined) throw new NotFoundError(`Chapter ${id} was not found`);
  return chapter;
}

function inkOf(chapter: DiscoverChapter): string {
  return inkSection(chapter.text, 'chapter').ink;
}

function proseOf(chapter: DiscoverChapter, max = 3_000): string {
  const prose = projectInk(inkOf(chapter));
  return prose.length <= max ? prose : `${prose.slice(0, max)}…`;
}

/** The one-line summary a beat's planning holds, or the start of its prose. */
function summaryOf(chapter: DiscoverChapter): string {
  const head = inkSection(chapter.text, 'chapter').head;
  const beat = /^##\s+Beat\s*\n+([^\n#][^\n]*)/mu.exec(head)?.[1]?.trim();
  if (beat !== undefined && !beat.startsWith('_')) return beat;
  const prose = projectInk(inkOf(chapter)).replace(/\s+/gu, ' ').trim();
  return prose.length <= 140 ? prose : `${prose.slice(0, 137)}…`;
}

/** The text of each closing choice a chapter ends with, when its ending is one the choices screen reads. */
function closingTexts(chapter: DiscoverChapter): string[] {
  const read = readEnding(inkOf(chapter));
  return read.editable ? read.ending.choices.map((choice) => choice.text.trim()) : [];
}

/**
 * Whether the reader stands at a chapter's closing choices, where the
 * reader's own action can be added, rather than at choices inside a scene.
 */
function atClosingChoices(
  replayed: ReplayedPosition,
  knot: string,
  closing: readonly string[],
): boolean {
  return (
    closing.length > 0 &&
    replayed.choices.every(
      (choice) => choice.sourcePath.split('.')[0] === knot && closing.includes(choice.text.trim()),
    )
  );
}

function hashOf(files: DiscoverFiles, path: string): string | null {
  return files.hashes.get(path) ?? null;
}

export class DiscoverService {
  private readonly books = new Map<string, BookJobs>();

  constructor(
    private readonly db: Database.Database,
    private readonly bookService: BookService,
    private readonly settings: SettingsService,
    private readonly providers: ProviderService,
    private readonly roles: {
      agents: CustomAgentService;
      skills: SkillService;
      tools: AgentToolRegistry;
    },
    private readonly logError: (error: unknown) => void = () => undefined,
  ) {}

  /**
   * The custom agent the setup picks for the beat writer: its instructions
   * and its skills, of those the beat writer uses (beat writer skills and the
   * writer's own). The skills it names come loaded, with the text a chat's
   * activate_skill gives, so every beat follows them (within a budget, past
   * which the rest are listed to load); an agent allowed every
   * skill gets the list to load from, as in a chat. A deleted agent leaves
   * the default beat writer.
   */
  private role(setup: DiscoverSetup): BeatRole | null {
    if (setup.agentId === null) return null;
    let agent: CustomAgent;
    try {
      agent = this.roles.agents.get(setup.agentId);
    } catch {
      return null;
    }
    // Only beat writer skills and the writer's own, whatever the agent allows (ADR 0034).
    const named = agent.skills === null ? null : new Set(agent.skills);
    const usable = this.roles.skills
      .list()
      .filter((skill) => isBeatWriterSkill(skill) && (named === null || named.has(skill.name)));
    const allowed = new Set(usable.map((skill) => skill.name));
    const skills: BeatRole['skills'][number][] = [];
    let left = NAMED_SKILLS_BUDGET;
    for (const skill of usable) {
      const entry = { name: skill.name, description: skill.description, content: null };
      if (named === null) {
        skills.push(entry);
        continue;
      }
      // A named skill that cannot be read is left out rather than offered.
      const content = this.loadedSkill(skill.name, allowed);
      if (content === null) continue;
      // Each loaded skill is whole; past the budget, the rest are listed to load.
      if (content.length > left) {
        skills.push(entry);
        continue;
      }
      left -= content.length;
      skills.push({ ...entry, content });
    }
    return { name: agent.name, instructions: agent.instructions, allowed, skills };
  }

  /** A named skill's text as activate_skill gives it, under the same limit; null if it cannot be read. */
  private loadedSkill(name: string, allowed: ReadonlySet<string>): string | null {
    try {
      return truncateResult(this.roles.tools.activateSkill(name, allowed));
    } catch {
      return null;
    }
  }

  // ---- State ----------------------------------------------------------------

  async state(book: string): Promise<DiscoverState> {
    const files = await this.bookService.discoverFiles(book);
    const beats = discoverBeats(files.chapters, this.reads(book));
    const seeds = beats.filter((beat) => beat.state === 'seed');
    const reached = seeds.length === 0 ? new Map() : await this.bookService.discoverPaths(book);
    const problem = this.writerProblem();
    return {
      setup: readSetup(files.setup, files.story),
      rules: readRules(files.rules),
      variables: readVariables(files.variables),
      proposals: this.proposals(book),
      beats,
      openThreads: seeds.map((beat) => ({
        chapterId: beat.chapterId,
        title: beat.title,
        from: beat.from,
        playPath: reached.get(beat.knot) ?? null,
      })),
      needsReview: beats.filter(
        (beat) => beat.state === 'written' && beat.stale && (beat.read || beat.edited),
      ),
      jobs: this.jobs(book).records.map((record) => record.job),
      closingChoices: Object.fromEntries(
        files.chapters.flatMap((chapter) => {
          const texts = closingTexts(chapter);
          return texts.length === 0 ? [] : [[chapter.id, texts]];
        }),
      ),
      writerReady: problem === null,
      writerProblem: problem,
    };
  }

  private writerProblem(): string | null {
    const config = this.settings.getSettings().providerConfig;
    if (!config) return 'Configure a provider in Settings to write with the beat writer.';
    if (!supportsTools(config.source) || googleModelWithoutTools(config)) {
      return 'The configured model does not support tool calling, which the beat writer needs.';
    }
    return null;
  }

  private model(signal: AbortSignal): ModelAccess {
    const problem = this.writerProblem();
    if (problem !== null) throw new ConfigurationError(problem);
    const settings = this.settings.getSettings();
    return {
      providers: this.providers,
      config: settings.providerConfig!,
      controls: settings.agentGeneration,
      signal,
    };
  }

  // ---- Setup ----------------------------------------------------------------

  /**
   * Saves the setup as one checkpoint: setup.md, the rules, the kernel in
   * story.md, and the variables. A book with no chapters gets its opening:
   * the writer's own scene, or a seed the beat writer writes.
   */
  async saveSetup(book: string, input: SaveDiscoverSetupInput): Promise<DiscoverState> {
    const files = await this.bookService.discoverFiles(book);
    if (input.setup.agentId !== null) {
      try {
        this.roles.agents.get(input.setup.agentId);
      } catch {
        throw new ValidationError('That agent no longer exists. Pick another, or the default.');
      }
    }
    // The beat writer writes a new book's opening from the premise; with a scene already there, it is optional.
    if (
      input.setup.kernel === '' &&
      files.chapters.length === 0 &&
      (input.opening ?? '').trim() === ''
    ) {
      throw new ValidationError('Write the premise, or the opening scene, first.');
    }
    const writes = new Map<string, string>([
      [SETUP_FILE, setupFile(input.setup)],
      [RULES_FILE, rulesFile(input.rules)],
      ['story.md', withKernel(files.story, input.setup.kernel)],
      [INK_VARIABLES_FILE, withVariables(files.variables, input.variables)],
    ]);
    const opening = files.chapters.length === 0 ? openingChapter(input.opening ?? null) : null;
    if (opening !== null) writes.set(opening.path, opening.text);
    await this.bookService.writeDiscover(book, {
      label: files.setup === null ? 'Set up discovery' : 'Change the story setup',
      actor: 'user',
      files: writes,
      expected: new Map([...writes.keys()].map((path) => [path, hashOf(files, path)])),
    });
    await this.planLead(book);
    return this.state(book);
  }

  /** Asks the beat writer for the variables the story should track, for the setup form. */
  proposeVariables(book: string, input: ProposeVariablesInput): Promise<DiscoverState> {
    // A new proposal replaces the last one, which the form has shown or the writer dismissed.
    const jobs = this.jobs(book);
    jobs.records = jobs.records.filter(
      (record) => record.task.kind !== 'variables' || record.job.status === 'running',
    );
    return this.enqueueAndState(book, {
      task: { kind: 'variables', kernel: input.kernel, shape: input.shape },
      title: 'Proposing story variables',
      chapterId: null,
      lead: false,
    });
  }

  /**
   * Asks the beat writer to draft the premise, shape and tone, and endings
   * from the bible and story.md, for the setup form, where the writer edits
   * them before saving.
   */
  proposeStory(book: string, input: ProposeStoryInput): Promise<DiscoverState> {
    const jobs = this.jobs(book);
    jobs.records = jobs.records.filter(
      (record) => record.task.kind !== 'story' || record.job.status === 'running',
    );
    return this.enqueueAndState(book, {
      task: { kind: 'story', draft: input },
      title: 'Drafting the premise',
      chapterId: null,
      lead: false,
    });
  }

  async decideProposal(
    book: string,
    id: string,
    decision: ProposalDecision,
  ): Promise<DiscoverState> {
    const row = this.db
      .prepare('SELECT * FROM discover_proposals WHERE id = ? AND book = ?')
      .get(id, book) as ProposalRow | undefined;
    if (row === undefined) throw new NotFoundError(`Proposal ${id} was not found`);
    if (decision.approve) {
      const variable = decision.variable ?? {
        name: row.name,
        initial: row.initial,
        meaning: row.meaning,
      };
      const files = await this.bookService.discoverFiles(book);
      const current = readVariables(files.variables);
      if (!current.some((entry) => entry.name === variable.name)) {
        await this.bookService.writeDiscover(book, {
          label: `Add the variable ${variable.name}`,
          actor: 'user',
          files: new Map([
            [INK_VARIABLES_FILE, withVariables(files.variables, [...current, variable])],
          ]),
          expected: new Map([[INK_VARIABLES_FILE, hashOf(files, INK_VARIABLES_FILE)]]),
        });
      }
    }
    this.db.prepare('DELETE FROM discover_proposals WHERE id = ?').run(id);
    return this.state(book);
  }

  // ---- Where the reader is ---------------------------------------------------

  /** Records where the reader is: the chapters on the path are read, and lead mode plans from there. */
  async position(book: string, position: PlayPosition): Promise<DiscoverState> {
    const files = await this.bookService.discoverFiles(book);
    const replayed = this.replay(files, position);
    if (replayed !== null) {
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO discover_reads (book, chapter_id, read_at) VALUES (?, ?, ?)',
      );
      const now = new Date().toISOString();
      this.db.transaction(() => {
        for (const id of replayed.visited) insert.run(book, id, now);
      })();
    }
    this.jobs(book).position = position;
    await this.planLead(book);
    return this.state(book);
  }

  /** Lead mode: queues what the frontier needs, and drops queued lead jobs it no longer needs. */
  private async planLead(book: string): Promise<void> {
    let files: DiscoverFiles;
    try {
      files = await this.bookService.discoverFiles(book);
    } catch {
      return;
    }
    const setup = readSetup(files.setup, files.story);
    const jobs = this.jobs(book);
    if (setup === null || setup.mode !== 'lead' || this.writerProblem() !== null) {
      // Co-write mode (or no setup, or no writer) writes nothing on its own: drop what lead mode queued.
      jobs.records = jobs.records.filter(
        (record) => !record.lead || record.job.status !== 'queued',
      );
      return;
    }
    const structure = files.reading.structure;
    if (structure === null) return;
    const position = jobs.position ?? START;
    const replayed = this.replay(files, position);
    const beats = discoverBeats(files.chapters, this.reads(book));
    const current = replayed?.current ?? files.reading.assembled.chapters[0]?.id ?? null;
    if (current === null) return;
    const items = leadFrontier(beats, structure.nodes, current, setup.lookahead);
    const wanted = new Set(items.map((item) => `${item.kind}:${item.chapterId}`));
    jobs.records = jobs.records.filter(
      (record) =>
        !record.lead ||
        record.job.status !== 'queued' ||
        wanted.has(`${record.task.kind}:${record.job.chapterId}`),
    );
    for (const item of items) this.enqueueLead(book, files, item, position);
    void this.pump(book);
  }

  private enqueueLead(
    book: string,
    files: DiscoverFiles,
    item: FrontierItem,
    position: PlayPosition,
  ) {
    const jobs = this.jobs(book);
    const exists = jobs.records.some(
      (record) =>
        record.job.chapterId === item.chapterId &&
        (record.task.kind === item.kind || record.task.kind === 'drafts') &&
        record.job.status !== 'done',
    );
    if (exists) return;
    const chapter = files.chapters.find((entry) => entry.id === item.chapterId);
    const title = chapter?.title ?? item.chapterId;
    const task: Task =
      item.kind === 'beat'
        ? { kind: 'beat', chapterId: item.chapterId, position, direction: null }
        : item.kind === 'choices'
          ? { kind: 'choices', chapterId: item.chapterId, position }
          : { kind: 'rewrite', chapterId: item.chapterId, position, direction: null, force: false };
    this.enqueue(book, {
      task,
      chapterId: item.chapterId,
      title:
        item.kind === 'beat'
          ? `Writing "${title}"`
          : item.kind === 'choices'
            ? `Writing choices for "${title}"`
            : `Rewriting "${title}"`,
      lead: true,
    });
  }

  // ---- Requests from the writer ----------------------------------------------

  /** Writes a seed, or rewrites a written beat keeping where its choices lead, with an optional direction. */
  async writeBeat(book: string, input: WriteBeatInput): Promise<DiscoverState> {
    const files = await this.bookService.discoverFiles(book);
    const beat = discoverBeats(files.chapters, this.reads(book)).find(
      (entry) => entry.chapterId === input.chapterId,
    );
    const chapter = chapterOf(files, input.chapterId);
    const direction = input.direction?.trim() || null;
    const needsChoices =
      beat?.state === 'written' &&
      readEnding(inkOf(chapter)).ending.choices.length === 0 &&
      !beat.ending;
    const task: Task =
      beat === undefined || beat.state === 'seed'
        ? { kind: 'beat', chapterId: input.chapterId, position: input.position, direction }
        : needsChoices
          ? { kind: 'choices', chapterId: input.chapterId, position: input.position }
          : {
              kind: 'rewrite',
              chapterId: input.chapterId,
              position: input.position,
              direction,
              force: true,
            };
    if (beat === undefined && task.kind === 'beat') {
      // A chapter discovery does not manage: continue it with choices instead of rewriting the writer's prose.
      return this.enqueueAndState(book, {
        task: { kind: 'choices', chapterId: input.chapterId, position: input.position },
        chapterId: input.chapterId,
        title: `Writing choices for "${chapter.title}"`,
        lead: false,
      });
    }
    return this.enqueueAndState(book, {
      task,
      chapterId: input.chapterId,
      title:
        task.kind === 'beat'
          ? `Writing "${chapter.title}"`
          : task.kind === 'choices'
            ? `Writing choices for "${chapter.title}"`
            : `Rewriting "${chapter.title}"`,
      lead: false,
    });
  }

  async draft(book: string, input: DraftBeatInput): Promise<DiscoverState> {
    const files = await this.bookService.discoverFiles(book);
    const beat = discoverBeats(files.chapters, this.reads(book)).find(
      (entry) => entry.chapterId === input.chapterId,
    );
    if (beat?.state !== 'seed') {
      throw new ConflictError('not_a_seed', 'Drafts are for a beat that is not written yet.');
    }
    const jobs = this.jobs(book);
    // A new request replaces the drafts the writer has not picked from.
    jobs.records = jobs.records.filter(
      (record) =>
        !(
          record.task.kind === 'drafts' &&
          record.job.chapterId === input.chapterId &&
          record.job.status === 'done'
        ),
    );
    return this.enqueueAndState(book, {
      task: {
        kind: 'drafts',
        chapterId: input.chapterId,
        position: input.position,
        direction: input.direction?.trim() || null,
      },
      chapterId: input.chapterId,
      title: `Drafting "${beat.title}"`,
      lead: false,
    });
  }

  /** Writes the draft the writer picked. */
  async acceptDraft(book: string, jobId: string, draftId: string): Promise<DiscoverState> {
    const record = this.record(book, jobId);
    const proposal = record.proposals.get(draftId);
    if (record.task.kind !== 'drafts' || proposal === undefined) {
      throw new NotFoundError(`Draft ${draftId} was not found`);
    }
    const files = await this.bookService.discoverFiles(book);
    const outcome = await this.commitBeat(book, files, record.task.chapterId, proposal, 'seed');
    if (!outcome.done) {
      // The book changed since the draft was made and it no longer compiles; keep the drafts to pick another.
      throw new ValidationError(
        `This draft no longer fits the book:\n${outcome.problems.join('\n')}`,
      );
    }
    this.jobs(book).records = this.jobs(book).records.filter((entry) => entry !== record);
    await this.planLead(book);
    return this.state(book);
  }

  somethingElse(book: string, input: SomethingElseInput): Promise<DiscoverState> {
    return this.enqueueAndState(book, {
      task: {
        kind: 'something-else',
        position: input.position,
        action: input.action,
        force: input.force === true,
      },
      chapterId: null,
      title: `${input.force === true ? 'Writing' : 'Trying'} "${input.action.length > 60 ? `${input.action.slice(0, 57)}…` : input.action}"`,
      lead: false,
    });
  }

  async markReviewed(book: string, chapterId: string): Promise<DiscoverState> {
    const files = await this.bookService.discoverFiles(book);
    const chapter = chapterOf(files, chapterId);
    const from = parseFrontmatter(chapter.text).frontmatter?.['discover-from'];
    if (typeof from !== 'string') {
      throw new ConflictError(
        'not_a_beat',
        'Only a beat written from another can be marked reviewed.',
      );
    }
    const parent = chapterOf(files, from);
    await this.bookService.writeDiscover(book, {
      label: `Mark ${chapter.title} reviewed`,
      actor: 'user',
      files: new Map([[chapter.path, markReviewed(chapter.text, inkOf(parent))]]),
      expected: new Map([[chapter.path, hashOf(files, chapter.path)]]),
    });
    return this.state(book);
  }

  async setSeedNote(book: string, chapterId: string, note: string): Promise<DiscoverState> {
    const files = await this.bookService.discoverFiles(book);
    const beat = discoverBeats(files.chapters, new Set()).find(
      (entry) => entry.chapterId === chapterId,
    );
    if (beat?.state !== 'seed') throw new ConflictError('not_a_seed', 'Only a seed has a note.');
    const chapter = chapterOf(files, chapterId);
    await this.bookService.writeDiscover(book, {
      label: `Note on ${chapter.title}`,
      actor: 'user',
      files: new Map([[chapter.path, withSeedNote(chapter.text, note)]]),
      expected: new Map([[chapter.path, hashOf(files, chapter.path)]]),
    });
    return this.state(book);
  }

  /** Stops a job if it is running and removes it. */
  dismiss(book: string, jobId: string): Promise<DiscoverState> {
    const record = this.record(book, jobId);
    record.controller?.abort();
    const jobs = this.jobs(book);
    jobs.records = jobs.records.filter((entry) => entry !== record);
    return this.state(book);
  }

  /** Runs a failed job again. */
  retry(book: string, jobId: string): Promise<DiscoverState> {
    const record = this.record(book, jobId);
    if (record.job.status !== 'failed') {
      throw new ConflictError('not_failed', 'Only a job that failed can be run again.');
    }
    record.job = { ...record.job, status: 'queued', message: null };
    void this.pump(book);
    return this.state(book);
  }

  // ---- Book lifecycle -------------------------------------------------------

  /** Refuses to trash or move a book while the beat writer is working in it. */
  assertBookIdle(book: string, action = 'trashing it'): void {
    if (this.books.get(book)?.running) {
      throw new ConflictError(
        'generation_in_progress',
        `The beat writer is working in this book. Wait for it to finish before ${action}.`,
      );
    }
  }

  removeForBook(book: string): void {
    for (const record of this.books.get(book)?.records ?? []) record.controller?.abort();
    this.books.delete(book);
    this.db.prepare('DELETE FROM discover_reads WHERE book = ?').run(book);
    this.db.prepare('DELETE FROM discover_proposals WHERE book = ?').run(book);
  }

  // ---- Jobs -----------------------------------------------------------------

  private jobs(book: string): BookJobs {
    let jobs = this.books.get(book);
    if (jobs === undefined) {
      jobs = { records: [], running: false, position: null };
      this.books.set(book, jobs);
    }
    return jobs;
  }

  private record(book: string, id: string): JobRecord {
    const record = this.jobs(book).records.find((entry) => entry.job.id === id);
    if (record === undefined) throw new NotFoundError(`Job ${id} was not found`);
    return record;
  }

  private enqueue(
    book: string,
    input: { task: Task; chapterId: string | null; title: string; lead: boolean },
  ): JobRecord {
    if (this.writerProblem() !== null) throw new ConfigurationError(this.writerProblem()!);
    const record: JobRecord = {
      job: {
        id: randomUUID(),
        kind: input.task.kind,
        chapterId: input.chapterId,
        title: input.title,
        status: 'queued',
        message: null,
        drafts: [],
        outcome: null,
        variables: [],
        story: null,
        createdAt: new Date().toISOString(),
      },
      task: input.task,
      lead: input.lead,
      controller: null,
      proposals: new Map(),
    };
    const jobs = this.jobs(book);
    // The writer's own requests go before lead mode's.
    const firstLead = jobs.records.findIndex(
      (entry) => entry.lead && entry.job.status === 'queued',
    );
    if (!input.lead && firstLead !== -1) jobs.records.splice(firstLead, 0, record);
    else jobs.records.push(record);
    const finished = jobs.records.filter(
      (entry) => entry.job.status === 'done' || entry.job.status === 'failed',
    );
    if (finished.length > KEEP_FINISHED) {
      const drop = new Set(finished.slice(0, finished.length - KEEP_FINISHED));
      jobs.records = jobs.records.filter((entry) => !drop.has(entry));
    }
    return record;
  }

  private enqueueAndState(
    book: string,
    input: { task: Task; chapterId: string | null; title: string; lead: boolean },
  ): Promise<DiscoverState> {
    this.enqueue(book, input);
    void this.pump(book);
    return this.state(book);
  }

  /** Runs the book's queued jobs one at a time. */
  private async pump(book: string): Promise<void> {
    const jobs = this.jobs(book);
    if (jobs.running) return;
    jobs.running = true;
    try {
      for (;;) {
        const record = jobs.records.find((entry) => entry.job.status === 'queued');
        if (record === undefined) break;
        record.controller = new AbortController();
        record.job = { ...record.job, status: 'running' };
        try {
          const message = await this.run(book, record);
          record.job = { ...record.job, status: 'done', message: message ?? null };
          // A written beat is in the book now and needs no row of its own, unless it carries a note.
          const writes = ['beat', 'choices', 'rewrite'].includes(record.task.kind);
          if (writes && message === undefined) {
            jobs.records = jobs.records.filter((entry) => entry !== record);
          }
        } catch (error) {
          if (record.controller.signal.aborted) {
            jobs.records = jobs.records.filter((entry) => entry !== record);
          } else {
            if (!(error instanceof BeatWriterError) && !(error instanceof ConflictError)) {
              this.logError(error);
            }
            record.job = {
              ...record.job,
              status: 'failed',
              message: error instanceof Error ? error.message : String(error),
            };
          }
        } finally {
          record.controller = null;
        }
        await this.planLead(book);
      }
    } finally {
      jobs.running = false;
    }
  }

  /** Runs one job; resolves with a note for the writer, if any. */
  private async run(book: string, record: JobRecord): Promise<string | undefined> {
    const signal = record.controller!.signal;
    const model = this.model(signal);
    const { task } = record;
    if (task.kind === 'variables') {
      record.job = { ...record.job, variables: await this.suggestVariables(book, model, task) };
      return 'Proposed.';
    }
    if (task.kind === 'story') {
      record.job = { ...record.job, story: await this.suggestStory(book, model, task.draft) };
      return 'Drafted.';
    }
    const files = await this.bookService.discoverFiles(book);
    const setup = readSetup(files.setup, files.story);
    if (setup === null) {
      throw new ConflictError('no_setup', 'Set the book up for discovery first.');
    }
    if (task.kind === 'something-else')
      return this.runSomethingElse(book, record, model, files, setup, task);
    if (task.kind === 'drafts') return this.runDrafts(book, record, model, files, setup, task);
    return this.runWrite(book, model, files, setup, task);
  }

  // ---- Writing --------------------------------------------------------------

  private async runWrite(
    book: string,
    model: ModelAccess,
    files: DiscoverFiles,
    setup: DiscoverSetup,
    task: Extract<Task, { kind: 'beat' | 'choices' | 'rewrite' }>,
  ): Promise<string | undefined> {
    const beat = discoverBeats(files.chapters, this.reads(book)).find(
      (entry) => entry.chapterId === task.chapterId,
    );
    const chapter = chapterOf(files, task.chapterId);
    // Written meanwhile, or (for lead mode's rewrites) read or edited meanwhile: leave it to the writer.
    if (task.kind === 'beat' && beat?.state !== 'seed') return undefined;
    if (
      task.kind === 'rewrite' &&
      !task.force &&
      (beat === undefined || beat.read || beat.edited)
    ) {
      return undefined;
    }
    // Choices go on from the chapter itself, so the path is the one that reaches it, the writer's own chapters included.
    const context = await this.promptInput(
      book,
      files,
      task.chapterId,
      task.position,
      task.kind === 'choices',
    );
    const system = beatSystemPrompt({
      bookTitle: files.title,
      setup,
      rules: readRules(files.rules),
      role: this.role(setup),
    });
    const notes: string[] = [];
    const review = this.reviewer(model, context, notes);
    const handlers = this.readHandlers(book, task.chapterId, setup);
    let tools: BeatToolName[];
    let prompt: string;
    if (task.kind === 'choices') {
      tools = ['write_choices'];
      prompt = beatTaskPrompt(context, {
        kind: 'choices',
        ink: inkOf(chapter),
        title: chapter.title,
      });
      handlers.write_choices = async (args) => {
        const fresh = await this.bookService.discoverFiles(book);
        const current = chapterOf(fresh, task.chapterId);
        const choices = args.choices.map(choiceFromArgs);
        const problems = checkChoices(choices, this.checkContext(fresh, setup, task.chapterId));
        if (problems.length > 0) return { done: false, problems };
        const reviewed = await review(fresh, proseOf(current, 8_000), choices);
        if (reviewed.length > 0) return { done: false, problems: reviewed };
        const built = choicesFiles({
          chapter: current,
          choices,
          chapters: fresh.chapters,
          nextNumber: nextChapterNumber(fresh.chapters),
        });
        if (built === null) {
          throw new ConflictError(
            'ending_not_editable',
            `${current.title} already ends in choices or in ink the choices screen cannot read.`,
          );
        }
        return this.write(
          book,
          fresh,
          built,
          `Discover: choices for ${current.title}`,
          current.path,
        );
      };
    } else {
      tools = ['write_beat'];
      const keep = task.kind === 'rewrite' ? this.keepTargets(files, chapter) : undefined;
      prompt =
        task.kind === 'beat'
          ? beatTaskPrompt(context, { kind: 'beat', direction: task.direction, avoid: [] })
          : beatTaskPrompt(context, {
              kind: 'rewrite',
              ink: inkOf(chapter),
              title: chapter.title,
              choices: this.currentChoices(files, chapter),
            });
      if (task.kind === 'rewrite' && task.direction !== null) {
        prompt += `\n\nThe writer's direction for the rewrite: ${task.direction}`;
      }
      handlers.write_beat = async (args) => {
        const proposal = proposalFromArgs(args);
        const fresh = await this.bookService.discoverFiles(book);
        const problems = checkBeat(proposal, {
          ...this.checkContext(fresh, setup, task.chapterId),
          ...(keep === undefined ? {} : { keepTargets: keep }),
        });
        if (problems.length > 0) return { done: false, problems };
        const reviewed = await review(fresh, projectInk(proposal.ink), proposal.choices);
        if (reviewed.length > 0) return { done: false, problems: reviewed };
        if (task.kind === 'rewrite' && !task.force) {
          const now = discoverBeats(fresh.chapters, this.reads(book)).find(
            (entry) => entry.chapterId === task.chapterId,
          );
          if (now === undefined || now.read || now.edited) {
            throw new ConflictError(
              'file_changed',
              'The reader reached this beat or it was edited while it was being rewritten, so it was left as it is.',
            );
          }
        }
        return this.commitBeat(
          book,
          fresh,
          task.chapterId,
          proposal,
          task.kind === 'beat' ? 'seed' : 'rewrite',
        );
      };
    }
    await runBeatWriter(model, { system, task: prompt, tools, handlers });
    return notes.length === 0 ? undefined : `Written. The review still noted: ${notes.join(' ')}`;
  }

  private async runDrafts(
    book: string,
    record: JobRecord,
    model: ModelAccess,
    files: DiscoverFiles,
    setup: DiscoverSetup,
    task: Extract<Task, { kind: 'drafts' }>,
  ): Promise<string | undefined> {
    const context = await this.promptInput(book, files, task.chapterId, task.position);
    const system = beatSystemPrompt({
      bookTitle: files.title,
      setup,
      rules: readRules(files.rules),
      role: this.role(setup),
    });
    const avoid: string[] = [];
    for (let index = 0; index < DRAFT_COUNT; index += 1) {
      let reviews = REVIEW_ROUNDS;
      const handlers = this.readHandlers(book, task.chapterId, setup);
      handlers.write_beat = async (args) => {
        const proposal = proposalFromArgs(args);
        const fresh = await this.bookService.discoverFiles(book);
        const problems = checkBeat(proposal, this.checkContext(fresh, setup, task.chapterId));
        if (problems.length > 0) return { done: false, problems };
        if (proposal.choices.length > 0 && reviews > 0) {
          const found = await reviewChoices(
            model,
            reviewPrompt({
              rules: readRules(fresh.rules),
              bible: context.bible.slice(0, 8_000),
              transcript: (context.transcript ?? '').slice(-6_000),
              beat: projectInk(proposal.ink),
              choices: describeChoices(
                proposal.choices,
                (id) => fresh.chapters.find((entry) => entry.id === id)?.title,
              ),
            }),
          );
          if (found.length > 0) {
            reviews -= 1;
            return { done: false, problems: found.map((problem) => `Review: ${problem}`) };
          }
        }
        const draftId = randomUUID();
        record.proposals.set(draftId, proposal);
        const built = this.buildBeat(fresh, task.chapterId, proposal);
        const draft: BeatDraft = {
          id: draftId,
          title: proposal.title,
          ink: inkSection(built.chapter.text, 'chapter').ink,
          prose: projectInk(proposal.ink),
          choices: proposal.choices.map((choice) => ({
            text: choice.text,
            intent: choice.intent,
            leads:
              choice.to.kind === 'new'
                ? 'A new beat'
                : choice.to.kind === 'end'
                  ? 'The end'
                  : `Rejoins ${fresh.chapters.find((entry) => entry.id === (choice.to as { chapterId: string }).chapterId)?.title ?? 'a beat'}`,
          })),
          ending: proposal.ending,
        };
        record.job = { ...record.job, drafts: [...record.job.drafts, draft] };
        avoid.push(
          proposal.summary.trim() === ''
            ? proposal.title
            : `${proposal.title}: ${proposal.summary}`,
        );
        return { done: true };
      };
      await runBeatWriter(model, {
        system,
        task: beatTaskPrompt(context, { kind: 'beat', direction: task.direction, avoid }),
        tools: ['write_beat'],
        handlers,
      });
    }
    return 'Pick a draft.';
  }

  private async runSomethingElse(
    book: string,
    record: JobRecord,
    model: ModelAccess,
    files: DiscoverFiles,
    setup: DiscoverSetup,
    task: Extract<Task, { kind: 'something-else' }>,
  ): Promise<string | undefined> {
    const replayed = this.replay(files, task.position);
    const currentId = replayed?.current ?? null;
    if (replayed === null || currentId === null || replayed.choices.length === 0) {
      throw new ConflictError(
        'no_choices_here',
        'Something else works where a beat offers its choices.',
      );
    }
    const current = chapterOf(files, currentId);
    const knot = inkKnotName(currentId);
    const ending = readEnding(inkOf(current));
    if (
      !ending.editable ||
      ending.ending.choices.length === 0 ||
      !atClosingChoices(replayed, knot, closingTexts(current))
    ) {
      throw new ConflictError(
        'no_choices_here',
        'Something else works where a beat ends in its choices, not inside a scene.',
      );
    }
    record.job = { ...record.job, chapterId: currentId };
    const context = await this.promptInput(book, files, currentId, task.position, true);
    const system = beatSystemPrompt({
      bookTitle: files.title,
      setup,
      rules: readRules(files.rules),
      role: this.role(setup),
    });
    const handlers = this.readHandlers(book, currentId, setup);
    const notes: string[] = [];
    const review = this.reviewer(model, context, notes);
    // When the writer overrules a decline, declining is not offered.
    if (!task.force) {
      handlers.decline_action = (args) => {
        record.job = {
          ...record.job,
          outcome: {
            accepted: false,
            action: task.action,
            reason: args.reason,
            suggestion: args.suggestion,
          },
        };
        return Promise.resolve({ done: true });
      };
    }
    handlers.accept_action = async (args) => {
      const fresh = await this.bookService.discoverFiles(book);
      const parent = chapterOf(fresh, currentId);
      const read = readEnding(inkOf(parent));
      const choice: BeatChoice = {
        ...choiceFromArgs({ ...args.choice, leads_to: 'new', note: '' }),
      };
      const beat = proposalFromArgs(args.beat);
      const existing: BeatChoice[] = read.ending.choices.map((entry) => ({
        text: entry.text,
        intent: 'existing',
        consequence: 'existing',
        condition: entry.condition,
        effects: entry.effects,
        to: { kind: 'existing', chapterId: entry.to },
      }));
      const checks = this.checkContext(fresh, setup, currentId);
      const problems = [
        ...checkChoices([...existing, choice], { ...checks, count: existing.length + 1 }).filter(
          (problem) => problem.includes(`"${choice.text}"`),
        ),
        ...checkBeat(beat, checks),
      ];
      if (problems.length > 0) return { done: false, problems };
      // The new beat's own choices pass the same review as any other beat's.
      const reviewed = await review(fresh, projectInk(beat.ink), beat.choices);
      if (reviewed.length > 0) return { done: false, problems: reviewed };
      const number = nextChapterNumber(fresh.chapters);
      const id = `chapter-${String(number).padStart(2, '0')}`;
      const path = `chapters/${id}.md`;
      const parentText = withAddedChoice(
        parent.text,
        {
          text: choice.text,
          once: true,
          condition: choice.condition,
          effects: choice.effects,
          to: inkKnotName(id),
        },
        `- **${choice.text}** (the reader's own action): ${[choice.intent, choice.consequence].filter((part) => part.trim() !== '').join(' — ')}`,
      );
      if (parentText === null) {
        throw new ConflictError(
          'no_choices_here',
          'Something else works where a beat ends in its choices.',
        );
      }
      const built = beatFiles({
        proposal: beat,
        chapter: { id, path, number, text: null },
        from: { id: currentId, ink: inkSection(parentText, 'chapter').ink },
        chapters: fresh.chapters,
        nextNumber: number + 1,
      });
      const outcome = await this.write(
        book,
        fresh,
        { chapter: built.chapter, seeds: built.seeds },
        `Discover: "${choice.text}"`,
        null,
        new Map([[parent.path, parentText]]),
      );
      if (!outcome.done) return outcome;
      const after = await this.bookService.discoverFiles(book);
      const replayedAfter = this.replay(after, task.position);
      const index =
        replayedAfter?.choices.findIndex((entry) => entry.text.trim() === choice.text.trim()) ?? -1;
      record.job = {
        ...record.job,
        outcome: {
          accepted: true,
          chapterId: currentId,
          choice: index === -1 ? (replayedAfter?.choices.length ?? 1) - 1 : index,
        },
      };
      return { done: true };
    };
    await runBeatWriter(model, {
      system,
      task: beatTaskPrompt(context, {
        kind: 'something-else',
        action: task.action,
        force: task.force,
        ink: inkOf(current),
        title: current.title,
        choices: this.currentChoices(files, current),
      }),
      tools: task.force ? ['accept_action'] : ['accept_action', 'decline_action'],
      handlers,
    });
    if (record.job.outcome?.accepted === false) return record.job.outcome.reason;
    return notes.length === 0 ? undefined : `Written. The review still noted: ${notes.join(' ')}`;
  }

  /**
   * The review pass for one job: the rules applied to a set of choices
   * before it is written. It sends a failing set back REVIEW_ROUNDS times;
   * after that the set is written and what the review still found goes in
   * `notes`, for the writer to see.
   */
  private reviewer(model: ModelAccess, context: BeatPromptInput, notes: string[]) {
    let reviews = REVIEW_ROUNDS;
    return async (fresh: DiscoverFiles, prose: string, choices: readonly BeatChoice[]) => {
      if (choices.length === 0) return [];
      const problems = await reviewChoices(
        model,
        reviewPrompt({
          rules: readRules(fresh.rules),
          bible: context.bible.slice(0, 8_000),
          transcript: (context.transcript ?? '').slice(-6_000),
          beat: prose,
          choices: describeChoices(
            choices,
            (id) => fresh.chapters.find((entry) => entry.id === id)?.title,
          ),
        }),
      );
      if (problems.length === 0) return [];
      if (reviews > 0) {
        reviews -= 1;
        return problems.map((problem) => `Review: ${problem}`);
      }
      notes.push(...problems);
      return [];
    };
  }

  /** A beat's files, built from the book as it is now. */
  private buildBeat(files: DiscoverFiles, chapterId: string, proposal: BeatProposal): BeatFiles {
    const chapter = chapterOf(files, chapterId);
    const from = parseFrontmatter(chapter.text).frontmatter?.['discover-from'];
    const parent =
      typeof from === 'string' ? files.chapters.find((entry) => entry.id === from) : undefined;
    const number = Number(chapter.number);
    return beatFiles({
      proposal,
      chapter: {
        id: chapter.id,
        path: chapter.path,
        number: Number.isInteger(number) && number > 0 ? number : nextChapterNumber(files.chapters),
        text: chapter.text,
      },
      from: parent === undefined ? null : { id: parent.id, ink: inkOf(parent) },
      chapters: files.chapters,
      nextNumber: nextChapterNumber(files.chapters),
    });
  }

  /**
   * Writes a proposed beat into its chapter, if the chapter is still what the
   * job was for: a seed for a new beat, an unread and unedited beat for a
   * rewrite. Compile errors go back to the beat writer to fix.
   */
  private async commitBeat(
    book: string,
    files: DiscoverFiles,
    chapterId: string,
    proposal: BeatProposal,
    expect: 'seed' | 'rewrite',
  ): Promise<HandlerOutcome> {
    const beat = discoverBeats(files.chapters, this.reads(book)).find(
      (entry) => entry.chapterId === chapterId,
    );
    if (expect === 'seed' && beat?.state !== 'seed') {
      throw new ConflictError(
        'file_changed',
        'This beat was written while the draft was being made.',
      );
    }
    const built = this.buildBeat(files, chapterId, proposal);
    return this.write(book, files, built, `Discover: write ${proposal.title}`, built.chapter.path);
  }

  private async write(
    book: string,
    files: DiscoverFiles,
    built: BeatFiles,
    label: string,
    chapterExpected: string | null,
    extra: ReadonlyMap<string, string> = new Map(),
  ): Promise<HandlerOutcome> {
    const writes = new Map<string, string>([
      [built.chapter.path, built.chapter.text],
      ...built.seeds.map((seed) => [seed.path, seed.text] as const),
      ...extra,
    ]);
    const expected = new Map<string, string | null>([
      [built.chapter.path, chapterExpected === null ? null : hashOf(files, chapterExpected)],
      ...built.seeds.map((seed) => [seed.path, null] as const),
      ...[...extra.keys()].map((path) => [path, hashOf(files, path)] as const),
    ]);
    try {
      await this.bookService.writeDiscover(book, {
        label,
        actor: 'agent',
        files: writes,
        expected,
      });
    } catch (error) {
      if (error instanceof ValidationError) return { done: false, problems: [error.message] };
      throw error;
    }
    return { done: true };
  }

  // ---- Context --------------------------------------------------------------

  private readHandlers(book: string, chapterId: string, setup: DiscoverSetup): BeatHandlers {
    const role = this.role(setup);
    return {
      // The picked agent's skills, loaded the way a chat loads them.
      ...(role === null || role.skills.length === 0
        ? {}
        : {
            skill: (name: string) => this.roles.tools.activateSkill(name, role.allowed),
            skillFile: (name: string, path: string) =>
              this.roles.tools.readSkillFile(name, path, role.allowed),
          }),
      read: (path) => {
        // A chapter asked for by id or knot ("chapter-04", "chapter_04.txt") is the chapter's file.
        const chapterId = /^(?:chapters\/)?chapter[-_](\d+)(?:\.\w+)?$/u.exec(path.trim())?.[1];
        const file =
          chapterId === undefined ? path : `chapters/chapter-${chapterId.padStart(2, '0')}.md`;
        try {
          return this.bookService.readFile(book, file).content;
        } catch (error) {
          return `Error: ${error instanceof Error ? error.message : String(error)} Chapters are read as chapters/chapter-04.md; search finds other files.`;
        }
      },
      search: (query) => {
        const results = this.bookService.search(book, query);
        return results.length === 0
          ? 'No matches.'
          : results
              .slice(0, 12)
              .map((result) => `${result.path} (${result.title}): ${result.excerpt}`)
              .join('\n');
      },
      propose: (variable) => {
        const loose = looseVariable(variable);
        const parsed = discoverVariableSchema.safeParse(
          loose ?? { name: variable.name, initial: variable.initial, meaning: variable.meaning },
        );
        if (!parsed.success) {
          return `Not recorded: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`;
        }
        const exists = this.db
          .prepare('SELECT 1 FROM discover_proposals WHERE book = ? AND name = ?')
          .get(book, parsed.data.name);
        if (exists === undefined) {
          this.db
            .prepare(
              `INSERT INTO discover_proposals (id, book, name, initial, meaning, reason, chapter_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              randomUUID(),
              book,
              parsed.data.name,
              parsed.data.initial,
              parsed.data.meaning,
              variable.reason,
              chapterId,
              new Date().toISOString(),
            );
        }
        return `Recorded. The writer has not approved ${parsed.data.name} yet, so do not use it in this beat.`;
      },
    };
  }

  private checkContext(
    files: DiscoverFiles,
    setup: DiscoverSetup,
    self: string,
  ): ChoiceCheckContext {
    const structure = files.reading.structure;
    return {
      count: setup.choices,
      variables: new Set(
        structure?.variables.map((variable) => variable.name) ??
          readVariables(files.variables).map((variable) => variable.name),
      ),
      chapters: new Set(files.chapters.map((chapter) => chapter.id)),
      knots: new Set(
        structure?.nodes.map((node) => node.name.split('.')[0]!) ??
          files.chapters.map((chapter) => inkKnotName(chapter.id)),
      ),
      self,
    };
  }

  /** Where a beat's choices lead now, as the rewrite must keep them. */
  private keepTargets(files: DiscoverFiles, chapter: DiscoverChapter): string[] {
    const chapterOfKnot = new Map(files.chapters.map((entry) => [inkKnotName(entry.id), entry.id]));
    return readEnding(inkOf(chapter)).ending.choices.map((choice) =>
      choice.to === 'END' || choice.to === 'DONE'
        ? 'end'
        : `existing:${chapterOfKnot.get(choice.to.split('.')[0]!) ?? choice.to}`,
    );
  }

  private currentChoices(files: DiscoverFiles, chapter: DiscoverChapter): string {
    const chapterOfKnot = new Map(files.chapters.map((entry) => [inkKnotName(entry.id), entry]));
    const choices = readEnding(inkOf(chapter)).ending.choices;
    if (choices.length === 0) return '(none)';
    return choices
      .map((choice, index) => {
        const target = chapterOfKnot.get(choice.to.split('.')[0]!);
        const leads = target === undefined ? choice.to : `${target.id} (${target.title})`;
        return `${index + 1}. "${choice.text}" → ${leads}${choice.effects.length === 0 ? '' : `; sets ${choice.effects.join(', ')}`}${choice.condition === '' ? '' : `; offered when ${choice.condition}`}`;
      })
      .join('\n');
  }

  private replay(files: DiscoverFiles, position: PlayPosition): ReplayedPosition | null {
    const { json } = files.reading.compiled;
    if (json === null) return null;
    try {
      return replayPosition(
        json,
        files.reading.assembled.chapters.map((chapter) => ({
          knot: chapter.knot,
          chapterId: chapter.id,
          title: chapter.title,
        })),
        (files.reading.structure?.variables ?? [])
          .filter((variable) => variable.kind === 'var')
          .map((variable) => variable.name),
        position,
      );
    } catch {
      return null;
    }
  }

  /**
   * What the reader has read on the way to a beat. For a seed it is the
   * path to the choice that leads there: the reader's own when they stand at
   * it (or at the seed), the reader's path and the beats between when it is
   * further ahead, else the shortest path that reaches the beat before it.
   * `here` is for the reader's own action and for choices added to a
   * chapter, where the reader's place is the chapter itself.
   */
  private async pathTo(
    book: string,
    files: DiscoverFiles,
    chapterId: string,
    position: PlayPosition | null,
    here: boolean,
  ): Promise<{ transcript: string | null; replayed: ReplayedPosition | null }> {
    const byId = new Map(files.chapters.map((chapter) => [chapter.id, chapter]));
    const fromOf = (id: string): string | null => {
      const chapter = byId.get(id);
      if (chapter === undefined) return null;
      const from = parseFrontmatter(chapter.text).frontmatter?.['discover-from'];
      return typeof from === 'string' ? from : null;
    };
    const target = here ? chapterId : fromOf(chapterId);
    if (target === null) return { transcript: null, replayed: null };
    const replayed = position === null ? null : this.replay(files, position);
    if (replayed !== null && (replayed.current === target || replayed.current === chapterId)) {
      return { transcript: transcriptText(replayed), replayed };
    }
    if (replayed?.current != null) {
      // Walk back from the beat before this one to where the reader is.
      const chain: string[] = [];
      for (let id: string | null = target; id !== null && chain.length < 12; id = fromOf(id)) {
        if (id === replayed.current) {
          const steps = chain.reverse().map((step) => {
            const chapter = byId.get(step)!;
            const choice = this.choiceInto(files, fromOf(step), step);
            return `> If the reader then chooses: ${choice}\n\n## ${chapter.title}\n\n${proseOf(chapter, 4_000)}`;
          });
          return { transcript: [transcriptText(replayed), ...steps].join('\n\n'), replayed };
        }
        chain.push(id);
      }
    }
    const reached = await this.bookService.discoverPaths(book);
    const path = reached.get(inkKnotName(target));
    if (path !== undefined) {
      const shortest = this.replay(files, { ...START, path });
      if (shortest !== null && shortest.current === target) {
        return { transcript: transcriptText(shortest), replayed: shortest };
      }
    }
    return { transcript: null, replayed: null };
  }

  /** The text of the choice in `from` that leads to `to`. */
  private choiceInto(files: DiscoverFiles, from: string | null, to: string): string {
    if (from === null) return '';
    const node = files.reading.structure?.nodes.find((entry) => entry.name === inkKnotName(from));
    const choice = node?.choices.find((entry) => entry.target?.split('.')[0] === inkKnotName(to));
    return choice?.text ?? '';
  }

  private async promptInput(
    book: string,
    files: DiscoverFiles,
    chapterId: string,
    position: PlayPosition | null,
    here = false,
  ): Promise<BeatPromptInput> {
    const setup = readSetup(files.setup, files.story)!;
    const chapter = chapterOf(files, chapterId);
    const from = parseFrontmatter(chapter.text).frontmatter?.['discover-from'];
    const parent =
      typeof from === 'string' ? files.chapters.find((entry) => entry.id === from) : undefined;
    const { transcript, replayed } = await this.pathTo(book, files, chapterId, position, here);
    const knot = inkKnotName(chapterId);
    const nodes = files.reading.structure?.nodes ?? [];
    const otherParents = nodes
      .filter(
        (node) =>
          node.kind === 'chapter' &&
          node.chapterId !== null &&
          node.chapterId !== parent?.id &&
          node.chapterId !== chapterId,
      )
      .flatMap((node) => {
        const choice = node.choices.find((entry) => entry.target?.split('.')[0] === knot);
        const other = files.chapters.find((entry) => entry.id === node.chapterId);
        return choice === undefined || other === undefined
          ? []
          : [
              {
                chapterId: other.id,
                title: other.title,
                prose: proseOf(other),
                choice: choice.text,
              },
            ];
      });
    const values = new Map(
      replayed?.variables.map((variable) => [variable.name, variable.value]) ?? [],
    );
    const beats = discoverBeats(files.chapters, new Set());
    return {
      kernel: setup.kernel,
      shape: setup.shape,
      storyNotes: storyNotes(files.story),
      styleSheet: this.styleSheet(book),
      bible: this.bible(book, transcript ?? ''),
      variables: readVariables(files.variables).map((variable) => ({
        ...variable,
        value: values.get(variable.name) ?? null,
      })),
      transcript,
      chapters: files.chapters.map((entry) => {
        const beat = beats.find((candidate) => candidate.chapterId === entry.id);
        return {
          chapterId: entry.id,
          title: entry.title,
          summary: beat?.state === 'seed' ? '' : summaryOf(entry),
          state:
            beat === undefined
              ? 'chapter'
              : beat.state === 'seed'
                ? 'not written yet'
                : beat.ending
                  ? 'an ending'
                  : 'written',
        };
      }),
      place: {
        chapterId,
        choiceText:
          parent === undefined ? null : this.choiceInto(files, parent.id, chapterId) || null,
        note: discoverBeats([chapter], new Set())[0]?.note ?? '',
        parent:
          parent === undefined
            ? null
            : { chapterId: parent.id, title: parent.title, ink: inkOf(parent) },
        otherParents,
        depth: this.depthOf(files, chapterId),
      },
    };
  }

  /** Which beat a chapter is on its path from the start, following discover-from back to a written chapter. */
  private depthOf(files: DiscoverFiles, chapterId: string): number {
    let depth = 1;
    const seen = new Set<string>();
    let id: string | undefined = chapterId;
    while (id !== undefined && !seen.has(id)) {
      seen.add(id);
      const chapter = files.chapters.find((entry) => entry.id === id);
      const from = chapter
        ? parseFrontmatter(chapter.text).frontmatter?.['discover-from']
        : undefined;
      if (typeof from !== 'string') break;
      depth += 1;
      id = from;
    }
    return depth;
  }

  private styleSheet(book: string): string | null {
    try {
      const { content } = this.bookService.readFile(book, 'style-sheet.md');
      return content.length <= 6_000 ? content : `${content.slice(0, 6_000)}…`;
    } catch {
      return null;
    }
  }

  /** Bible entries, those named on the path first, within a budget; read_file reaches the rest. */
  private bible(book: string, transcript: string): string {
    const text = transcript.toLowerCase();
    const entries = this.bookService
      .listFiles(book)
      .filter((file) => BIBLE_KINDS.has(file.kind))
      .map((file) => ({
        file,
        named:
          text.includes(file.title.toLowerCase()) ||
          (file.entityId !== null && text.includes(file.entityId.replace(/-/gu, ' '))),
      }))
      .sort((left, right) => Number(right.named) - Number(left.named));
    const parts: string[] = [];
    let used = 0;
    const left: string[] = [];
    for (const { file } of entries) {
      let content: string;
      try {
        content = this.bookService.readFile(book, file.path).content;
      } catch {
        continue;
      }
      const entry = content.length <= ENTRY_BUDGET ? content : `${content.slice(0, ENTRY_BUDGET)}…`;
      if (used + entry.length > BIBLE_BUDGET) {
        left.push(`${file.title} (${file.path})`);
        continue;
      }
      used += entry.length;
      parts.push(`### ${file.title} (${file.path})\n${entry.trim()}`);
    }
    if (left.length > 0) parts.push(`More entries, read with read_file: ${left.join(', ')}`);
    return parts.join('\n\n');
  }

  private async suggestVariables(
    book: string,
    model: ModelAccess,
    task: Extract<Task, { kind: 'variables' }>,
  ): Promise<DiscoverVariable[]> {
    const prompt = [
      'You help a writer set up an interactive book written in ink. Propose the story variables it should track from the start: the state that later choices and prose will depend on (trust between characters, what the protagonist knows, a resource, a reputation). Propose 3 to 8, each one tied to something in the premise or bible, no generic ones.',
      '',
      '## Story kernel',
      task.kernel.trim() === '' ? '(none yet)' : task.kernel.trim(),
      ...(task.shape.trim() === '' ? [] : ['', '## Shape and tone', task.shape.trim()]),
      '',
      '## Bible',
      this.bible(book, task.kernel).slice(0, 12_000) || '(no entries yet)',
      '',
      // The example names no character, so a model copying its shape does not copy its story.
      'Reply with JSON only: {"variables": [{"name": "name_of_state", "initial": "0", "meaning": "One line: what it tracks, its range, and what it changes"}]}. Name each one after this story (its characters, places, secrets); the protagonist is the one the reader plays, so track what others think of them, not what they think of themselves. Names use letters, digits, and _. initial is a number, true, false, or "quoted text". meaning is one line.',
    ].join('\n');
    const request = model.providers.createChatRequest(
      model.config,
      [{ role: 'user', content: prompt }],
      { ...model.controls, thinking: false },
    );
    const { text } = await streamStep(model.providers, model.config, request, model.signal);
    const parsed = readJsonReply(text);
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed as { variables?: unknown } | undefined)?.variables;
    const variables = new Map<string, DiscoverVariable>();
    for (const entry of Array.isArray(list) ? list : []) {
      const variable = looseVariable(entry);
      if (variable !== null && !variables.has(variable.name)) {
        variables.set(variable.name, variable);
      }
    }
    if (variables.size === 0) {
      throw new BeatWriterError(
        parsed === undefined
          ? 'The model did not answer with a list of variables. Try again, or add them yourself.'
          : 'The model proposed no variables that ink can use. Try again, or add them yourself.',
      );
    }
    return [...variables.values()];
  }

  private async suggestStory(
    book: string,
    model: ModelAccess,
    draft: ProposeStoryInput,
  ): Promise<StoryDraft> {
    const files = await this.bookService.discoverFiles(book);
    const notes = storyNotes(files.story);
    const scenes = this.writtenScenes(files, draft.opening ?? '');
    const given = (label: string, text: string) =>
      text.trim() === '' ? [] : ['', `## ${label} (the writer's, so far)`, text.trim()];
    const prompt = [
      "You help a writer set up an interactive book written in ink, discovered by playing it: a beat writer writes each scene and the choices it ends with. Draft the story setup from the book's bible and notes. Where the writer has written a field already, keep their ideas and their words, and only fill out what is missing. When scenes are already written, the setup describes that story: its protagonist, situation, and tone, and where it can go from there. Ground everything in the scenes, bible, and notes; where they say little, propose something specific rather than generic.",
      '',
      '- kernel: the premise, one paragraph: a character in a situation, what they want, what stands in the way, and the tone.',
      '- shape: shape and tone, a few sentences: length, mood, what kind of choices the reader faces, anything the beat writer should keep in mind.',
      '- endings: the endings wanted, one short line ("Three, one of them bittersweet").',
      '',
      `## Book: ${files.title}`,
      ...given('Premise', draft.kernel),
      ...given('Shape and tone', draft.shape),
      ...given('Endings', draft.endings),
      ...(scenes === '' ? [] : ['', '## Written so far', scenes]),
      ...(notes === '' ? [] : ['', '## Notes from story.md', notes]),
      '',
      '## Bible',
      this.bible(book, `${draft.kernel}\n${scenes}`).slice(0, 12_000) || '(no entries yet)',
      '',
      'Reply with JSON only: {"kernel": "…", "shape": "…", "endings": "…"}',
    ].join('\n');
    const request = model.providers.createChatRequest(
      model.config,
      [{ role: 'user', content: prompt }],
      { ...model.controls, thinking: false },
    );
    const { text } = await streamStep(model.providers, model.config, request, model.signal);
    const parsed = readJsonReply(text);
    const fields = typeof parsed === 'object' && parsed !== null ? parsed : {};
    // A field the model leaves out or blank keeps what the writer sent.
    const field = (key: keyof StoryDraft, max: number) => {
      const value = (fields as Record<string, unknown>)[key];
      const text = typeof value === 'string' ? value.trim().slice(0, max).trim() : '';
      return text === '' ? draft[key] : text;
    };
    const story = storyDraftSchema.parse({
      kernel: field('kernel', 4000),
      shape: field('shape', 8000),
      endings: field('endings', 300).replace(/\s+/gu, ' '),
    });
    if (story.kernel === '') throw new BeatWriterError('The model did not draft a premise.');
    return story;
  }

  /** The story's written scenes, the opening first, within a budget: what a drafted setup describes. */
  private writtenScenes(files: DiscoverFiles, opening: string): string {
    if (files.chapters.length === 0) {
      const scene = opening.trim();
      return scene.length <= SCENES_BUDGET ? scene : `${scene.slice(0, SCENES_BUDGET)}…`;
    }
    const written = discoverBeats(files.chapters, new Set())
      .filter((beat) => beat.state === 'written')
      .sort((left, right) => Number(left.from !== null) - Number(right.from !== null));
    const parts: string[] = [];
    let used = 0;
    for (const beat of written) {
      const prose = proseOf(chapterOf(files, beat.chapterId)).trim();
      if (prose === '') continue;
      if (used + prose.length > SCENES_BUDGET) break;
      used += prose.length;
      parts.push(`### ${beat.title}\n${prose}`);
    }
    return parts.join('\n\n');
  }

  // ---- Stored state ---------------------------------------------------------

  private reads(book: string): Set<string> {
    return new Set(
      this.db
        .prepare('SELECT chapter_id FROM discover_reads WHERE book = ?')
        .pluck()
        .all(book) as string[],
    );
  }

  private proposals(book: string): VariableProposal[] {
    return (
      this.db
        .prepare('SELECT * FROM discover_proposals WHERE book = ? ORDER BY created_at, id')
        .all(book) as ProposalRow[]
    ).map((row) => ({
      id: row.id,
      variable: { name: row.name, initial: row.initial, meaning: row.meaning },
      reason: row.reason,
      chapterId: row.chapter_id,
      createdAt: row.created_at,
    }));
  }
}

/** story.md's body without its title heading and kernel, for the beat writer. */
function storyNotes(story: string): string {
  const body = parseFrontmatter(story)
    .body.replace(/^\s*#\s+[^\n]*\n/u, '')
    .replace(/^##\s+Story Kernel\s*\n[\s\S]*?(?=^##\s|$(?![\s\S]))/mu, '')
    .trim();
  return body.length <= 4_000 ? body : `${body.slice(0, 4_000)}…`;
}

/**
 * The first chapter of a book discovered from nothing: the writer's own
 * scene as ink (theirs, so the beat writer never rewrites it), or a seed the
 * beat writer writes from the kernel.
 */
function openingChapter(opening: string | null): { path: string; text: string } {
  const path = 'chapters/chapter-01.md';
  const scene = opening?.trim() ?? '';
  if (scene === '') {
    const seed = seedChapter({
      number: 1,
      title: 'Opening',
      fromId: '',
      fromTitle: '',
      choiceText: 'the start',
      note: 'The opening scene, from the story kernel.',
    });
    // The opening comes from nothing: no chapter leads to it.
    const text = seed.text
      .replace(/^discover-from: .*\n/mu, '')
      .replace(/Reached by choosing "the start" in \*\*\./u, 'The opening of the story.');
    return { path, text };
  }
  const heading = /^#\s+(.+)$/mu.exec(scene)?.[1]?.trim();
  const body = heading === undefined ? scene : scene.replace(/^#\s+.+\n?/mu, '');
  const ink = markdownToInk(body).join('\n');
  const title = heading ?? 'Opening';
  return {
    path,
    text: [
      '---',
      `title: ${JSON.stringify(title.slice(0, 80))}`,
      'number: 1',
      'status: draft',
      'mode: discovered',
      'discover: "written"',
      '---',
      '',
      '## Beat',
      '',
      '_The opening, written by the writer._',
      '',
      '## Chapter Text',
      '',
      `${ink.trimEnd()}`,
      '',
      '-> END',
      '',
    ].join('\n'),
  };
}
