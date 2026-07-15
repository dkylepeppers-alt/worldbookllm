import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import presetSchemaMarkdown from '../../../../docs/PRESET_SCHEMA.md?raw';

export function PresetSchemaPage() {
  return (
    <article className="schema-page">
      <div className="markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{presetSchemaMarkdown}</ReactMarkdown>
      </div>
    </article>
  );
}
