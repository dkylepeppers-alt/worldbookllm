import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * The web player export (ADR 0030): one HTML page that plays the story,
 * with inkjs's runtime and the compiled story inlined, so it needs nothing
 * else to run: no server, no network. It renders each line as a paragraph
 * with inline emphasis, chapter headings from `# chapter:` tags, `# break`
 * as a scene break, choices as buttons, and keeps one save in the browser.
 */

let runtime: string | null = null;

/** inkjs's browser runtime (its UMD bundle, which sets `inkjs`). */
function inkRuntime(): string {
  runtime ??= readFileSync(createRequire(import.meta.url).resolve('inkjs'), 'utf8').replace(
    /\/\/# sourceMappingURL=.*$/gmu,
    '',
  );
  return runtime;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`);
}

/** JSON safe inside a `<script>` element: `<` written as its JSON escape. */
function scriptJson(text: string): string {
  return text.replace(/</gu, '\\u003c');
}

/** JavaScript safe inside a `<script>` element. */
function scriptText(text: string): string {
  return text.replace(/<\/(script)/giu, '<\\/$1').replace(/<!--/gu, '<\\!--');
}

const STYLE = `
:root { --bg: #fbfbfa; --text: #1c1c1e; --muted: #6b6b70; --line: #e4e4e7; --accent: #4f46e5; --accent-text: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --bg: #161618; --text: #ececee; --muted: #9b9ba1; --line: #2e2e33; --accent: #8b85ff; --accent-text: #111114; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 18px/1.65 "Source Serif 4", Georgia, "Times New Roman", serif; }
main { max-width: 38rem; margin: 0 auto; padding: 3rem 1rem 4rem; }
header h1 { font-size: 1.6rem; line-height: 1.25; margin: 0 0 0.25rem; }
header p { color: var(--muted); margin: 0 0 2rem; font: 15px/1.5 system-ui, sans-serif; }
h2 { font-size: 1.25rem; margin: 2.25rem 0 0.75rem; }
p { margin: 0 0 1rem; }
hr { border: 0; text-align: center; margin: 2rem 0; }
hr::after { content: "* * *"; color: var(--muted); letter-spacing: 0.5em; }
.chosen { color: var(--muted); font-style: italic; }
ul.choices { list-style: none; padding: 0; margin: 1.5rem 0; display: grid; gap: 0.5rem; }
button { font: 16px/1.4 system-ui, sans-serif; color: inherit; background: transparent; border: 1px solid var(--line); border-radius: 10px; padding: 0.65rem 0.9rem; text-align: left; width: 100%; cursor: pointer; }
button:hover { border-color: var(--accent); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); width: auto; }
nav { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 2rem; border-top: 1px solid var(--line); padding-top: 1rem; }
nav button { width: auto; font-size: 14px; padding: 0.4rem 0.75rem; }
.end { color: var(--muted); }
`;

const PLAYER = `
(function () {
  var data = JSON.parse(document.getElementById('story-json').textContent);
  var meta = JSON.parse(document.getElementById('story-meta').textContent);
  var story = new inkjs.Story(data);
  var out = document.getElementById('story');
  var saveKey = 'ink-save:' + meta.id;

  function inline(text) {
    var html = text.replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
    return html
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\\*([^*\\s][^*]*)\\*/g, '$1<em>$2</em>')
      .replace(/(^|\\W)_([^_\\s][^_]*)_(?=\\W|$)/g, '$1<em>$2</em>');
  }
  function add(tag, html, className) {
    var element = document.createElement(tag);
    if (html !== null) element.innerHTML = html;
    if (className) element.className = className;
    out.appendChild(element);
    return element;
  }
  function tagValue(tags, name) {
    for (var i = 0; i < tags.length; i++) {
      var match = new RegExp('^\\\\s*' + name + '\\\\s*:\\\\s*(.*)$').exec(tags[i]);
      if (match) return match[1];
    }
    return null;
  }
  function run() {
    var first = null;
    while (story.canContinue) {
      var line = story.Continue().trim();
      var tags = story.currentTags || [];
      var chapter = tagValue(tags, 'chapter');
      if (chapter !== null) first = first || add('h2', inline(chapter));
      if (tags.some(function (t) { return /^\\s*break\\s*$/.test(t); })) add('hr', null);
      if (line === '') continue;
      var heading = /^#{1,6}\\s+(.*)$/.exec(line);
      var element = heading ? add('h2', inline(heading[1])) : add('p', inline(line));
      first = first || element;
    }
    var list = add('ul', null, 'choices');
    story.currentChoices.forEach(function (choice) {
      var item = document.createElement('li');
      var button = document.createElement('button');
      button.textContent = choice.text;
      button.addEventListener('click', function () {
        list.remove();
        add('p', inline(choice.text), 'chosen');
        story.ChooseChoiceIndex(choice.index);
        save();
        run();
      });
      item.appendChild(button);
      list.appendChild(item);
    });
    if (story.currentChoices.length === 0) {
      list.remove();
      add('p', 'The end.', 'end');
    }
    if (first) { first.setAttribute('tabindex', '-1'); first.focus({ preventScroll: true }); first.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }
  function save() {
    try { localStorage.setItem(saveKey, JSON.stringify({ state: story.state.toJson(), html: out.innerHTML })); } catch (e) {}
  }
  function restart() {
    try { localStorage.removeItem(saveKey); } catch (e) {}
    story.ResetState();
    out.innerHTML = '';
    run();
  }
  document.getElementById('restart').addEventListener('click', restart);
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(saveKey) || 'null'); } catch (e) {}
  if (saved && saved.state) {
    try {
      story.state.LoadJson(saved.state);
      out.innerHTML = saved.html.replace(/<ul class="choices">[\\s\\S]*$/, '').replace(/<p class="end">The end\\.<\\/p>$/, '');
      run();
      return;
    } catch (e) { story.ResetState(); out.innerHTML = ''; }
  }
  run();
})();
`;

export interface WebPlayerInput {
  title: string;
  author: string;
  ifid: string | null;
  /** The story in ink's JSON format. */
  story: string;
}

/** The web player page for a compiled story. */
export function webPlayerHtml(input: WebPlayerInput): string {
  const title = escapeHtml(input.title);
  const meta = JSON.stringify({ id: input.ifid ?? input.title });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="worldbookllm">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
<h1>${title}</h1>
${input.author.trim() === '' ? '' : `<p>${escapeHtml(input.author)}</p>`}
</header>
<div id="story" aria-live="polite"></div>
<nav aria-label="Story"><button type="button" id="restart">Start over</button></nav>
</main>
<script type="application/json" id="story-json">${scriptJson(input.story)}</script>
<script type="application/json" id="story-meta">${scriptJson(meta)}</script>
<script>${scriptText(inkRuntime())}</script>
<script>${PLAYER}</script>
</body>
</html>
`;
}
