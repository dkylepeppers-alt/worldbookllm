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

export interface AppSettingsRow {
  id: 1;
  default_preset_id: string;
  provider_config_json: string;
  agent_review_mode: 0 | 1;
  agent_generation_json: string;
  notebook_migration_seen: 0 | 1;
  notebook_archive_path: string | null;
}
