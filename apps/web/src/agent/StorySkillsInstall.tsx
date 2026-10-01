import type { StorySkillsInstallResult } from '@worldbookllm/shared';
import { useState } from 'react';

import { useApi } from '../api/useApi.js';
import { errorMessage } from '../books/useLoad.js';

interface StorySkillsInstallProps {
  onInstalled?: (result: StorySkillsInstallResult) => void;
  /** Leaves only the report once the install succeeds, for one-time prompts. */
  once?: boolean;
}

function count(n: number): string {
  return `${n} ${n === 1 ? 'skill' : 'skills'}`;
}

function report(result: StorySkillsInstallResult): string {
  const parts: string[] = [];
  if (result.installed.length > 0) parts.push(`Installed ${count(result.installed.length)}`);
  if (result.upgraded.length > 0) {
    parts.push(`updated ${count(result.upgraded.length)} to the bundled version`);
  }
  if (result.kept.length > 0) {
    parts.push(`kept ${count(result.kept.length)} you edited (${result.kept.join(', ')})`);
  }
  if (parts.length === 0) return 'Story Skills are already installed and up to date.';
  if (result.installed.length > 0 && result.skipped.length > 0) {
    parts.push(`${result.skipped.length} already present`);
  }
  const text = parts.join('; ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** Installs the bundled story-skills craft skills and updates unedited installs. */
export function StorySkillsInstall({ onInstalled, once = false }: StorySkillsInstallProps) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function install() {
    setBusy(true);
    setStatus(null);
    try {
      const result = await api.installStorySkills();
      setStatus({ ok: true, text: report(result) });
      onInstalled?.(result);
    } catch (caught) {
      setStatus({ ok: false, text: errorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {once && status?.ok === true ? null : (
        <button
          type="button"
          className="button-secondary"
          disabled={busy}
          onClick={() => void install()}
        >
          {busy ? 'Installing…' : 'Install Story Skills'}
        </button>
      )}
      {status === null ? null : (
        <p className={status.ok ? 'install-status' : 'form-error'} role="status">
          {status.text}
        </p>
      )}
    </>
  );
}
