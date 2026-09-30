import type { StorySkillsInstallResult } from '@worldbookllm/shared';
import { useState } from 'react';

import { useApi } from '../api/useApi.js';
import { errorMessage } from '../books/useLoad.js';

interface StorySkillsInstallProps {
  onInstalled?: (result: StorySkillsInstallResult) => void;
}

function report(result: StorySkillsInstallResult): string {
  const installed = result.installed.length;
  if (installed === 0) return 'Story Skills are already installed.';
  const skipped = result.skipped.length;
  return `Installed ${installed} ${installed === 1 ? 'skill' : 'skills'}${
    skipped === 0 ? '' : `; ${skipped} already present`
  }.`;
}

/** Installs the pinned story-skills craft skills into the skills library. */
export function StorySkillsInstall({ onInstalled }: StorySkillsInstallProps) {
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
      <button
        type="button"
        className="button-secondary"
        disabled={busy}
        onClick={() => void install()}
      >
        {busy ? 'Installing…' : 'Install Story Skills'}
      </button>
      {status === null ? null : (
        <p className={status.ok ? 'install-status' : 'form-error'} role="status">
          {status.text}
        </p>
      )}
    </>
  );
}
