import { StreamLanguage, type StringStream } from '@codemirror/language';

/**
 * Highlighting for a book file that holds ink (ADR 0030): frontmatter and a
 * chapter's Markdown planning as they are, and the ink below `## Chapter
 * Text` (or a whole `ink/` file's body) as ink: choices and gathers, knots
 * and stitches, diverts, logic in braces, `~` lines, tags, and comments.
 */

interface InkState {
  /** 0 before frontmatter, 1 inside it, 2 after it. */
  frontmatter: number;
  /** Whether this line is ink: after `## Chapter Text`, or anywhere in an `ink/` file's body. */
  ink: boolean;
  /** Inside a `/* … *\/` comment. */
  comment: boolean;
  /** Braces open on this line (logic and alternatives). */
  braces: number;
  /** At the first token of the line. */
  lineStart: boolean;
  /** The rest of the line is a tag. */
  tag: boolean;
}

const STATEMENT = /^(?:VAR|CONST|LIST|INCLUDE|EXTERNAL|TODO)\b/u;

function inkToken(stream: StringStream, state: InkState): string | null {
  if (state.comment) {
    if (stream.skipTo('*/')) {
      stream.match('*/');
      state.comment = false;
    } else stream.skipToEnd();
    return 'comment';
  }
  if (state.tag) {
    stream.skipToEnd();
    return 'meta';
  }
  if (stream.match('\\')) {
    stream.next();
    return null;
  }
  if (stream.match('//')) {
    stream.skipToEnd();
    return 'comment';
  }
  if (stream.match('/*')) {
    state.comment = true;
    return 'comment';
  }
  if (state.lineStart) {
    state.lineStart = false;
    if (stream.match(/^={2,}\s*[\w]+(?:\s*\([^)]*\))?\s*=*/u)) return 'heading';
    if (stream.match(/^=\s*\w+/u)) return 'heading';
    if (stream.match(/^(?:[*+]\s*)+/u)) {
      stream.match(/^\(\s*\w+\s*\)/u);
      return 'keyword';
    }
    if (stream.match(/^(?:-(?!>)\s*)+/u)) {
      stream.match(/^\(\s*\w+\s*\)/u);
      return 'keyword';
    }
    if (stream.match('~')) return 'keyword';
    if (stream.match(STATEMENT)) return 'keyword';
  }
  if (stream.match(/^->->/u)) return 'link';
  if (stream.match(/^(?:->|<-)\s*[\w.]*/u)) return 'link';
  if (stream.match('<>')) return 'operator';
  if (stream.peek() === '#') {
    stream.skipToEnd();
    return 'meta';
  }
  if (stream.match('{')) {
    state.braces += 1;
    return 'brace';
  }
  if (state.braces > 0) {
    if (stream.match('}')) {
      state.braces -= 1;
      return 'brace';
    }
    if (stream.match('|') || stream.match(':')) return 'operator';
    if (stream.match(/^(?:not|and|or|true|false|mod)\b/u)) return 'keyword';
    if (stream.match(/^\d+(?:\.\d+)?/u)) return 'number';
    if (stream.match(/^"[^"]*"/u)) return 'string';
  }
  if (stream.match('[') || stream.match(']')) return 'bracket';
  stream.next();
  return null;
}

/** The ink language for a chapter (`chapter`) or an `ink/` file (`ink`). */
export function inkLanguage(kind: 'chapter' | 'ink') {
  return StreamLanguage.define<InkState>({
    name: 'ink',
    startState: () => ({
      frontmatter: 0,
      ink: false,
      comment: false,
      braces: 0,
      lineStart: true,
      tag: false,
    }),
    copyState: (state) => ({ ...state }),
    token(stream, state) {
      if (stream.sol()) {
        state.lineStart = true;
        state.braces = 0;
        state.tag = false;
        const line = stream.string;
        if (state.frontmatter === 0) {
          state.frontmatter = /^\uFEFF?---\s*$/u.test(line) ? 1 : 2;
          if (state.frontmatter === 2 && kind === 'ink') state.ink = true;
          if (state.frontmatter === 1) {
            stream.skipToEnd();
            return 'meta';
          }
        } else if (state.frontmatter === 1) {
          if (/^---\s*$/u.test(line)) {
            state.frontmatter = 2;
            if (kind === 'ink') state.ink = true;
          }
          stream.skipToEnd();
          return 'meta';
        }
        if (!state.ink && /^ {0,3}##[ \t]+Chapter Text(?:[ \t]+#+)?[ \t]*$/iu.test(line)) {
          state.ink = true;
          stream.skipToEnd();
          return 'heading';
        }
        if (!state.ink) {
          stream.skipToEnd();
          return /^ {0,3}#{1,6}\s/u.test(line) ? 'heading' : null;
        }
        stream.eatSpace();
        if (stream.eol()) return null;
      }
      if (!state.ink) {
        stream.skipToEnd();
        return null;
      }
      return inkToken(stream, state);
    },
    blankLine(state) {
      state.braces = 0;
    },
    languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } } },
  });
}
