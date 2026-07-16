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
  origin_json: string;
  conversion_notes_json: string;
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
  skill_ids_json: string;
  provider_override_json: string;
  preset_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillRow {
  id: string;
  name: string;
  description: string;
  dir_path: string;
  origin_json: string;
  license: string | null;
  word_count: number;
  content_hash: string;
  created_at: string;
  updated_at: string;
}

export interface PresetRow {
  id: string;
  name: string;
  definition_json: string;
  created_at: string;
  updated_at: string;
}

export interface AppSettingsRow {
  id: 1;
  default_preset_id: string;
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
  /** JSON array of MessageVariant, or null for a single implicit variant. */
  variants_json: string | null;
  active_variant: number;
}
