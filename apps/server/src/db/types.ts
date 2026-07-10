export interface NotebookRow {
  id: string;
  name: string;
  settings_json: string;
  created_at: string;
  updated_at: string;
}

export interface SourceRow {
  id: string;
  notebook_id: string;
  title: string;
  slug: string;
  file_path: string;
  origin: 'paste';
  word_count: number;
  content_hash: string;
  created_at: string;
  updated_at: string;
}

export interface ChatRow {
  id: string;
  notebook_id: string;
  title: string;
  source_ids_json: string;
  provider_override_json: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  chat_id: string;
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  reasoning: string | null;
  status: 'complete' | 'interrupted' | 'error';
  context_json: string;
  created_at: string;
}
