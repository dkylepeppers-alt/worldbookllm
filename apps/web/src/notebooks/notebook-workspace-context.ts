import type { Notebook, SourceMetadata } from '@worldbookllm/shared';
import { createContext, useContext } from 'react';

export type SourcesState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; sources: SourceMetadata[] };

export interface NotebookWorkspaceValue {
  notebook: Notebook;
  notebookId: string;
  sourcesState: SourcesState;
  retrySources: () => void;
  addSource: (source: SourceMetadata) => void;
  removeSource: (sourceId: string) => void;
  lastSourceId: string | null;
  setLastSourceId: (sourceId: string | null) => void;
}

export const NotebookWorkspaceContext = createContext<NotebookWorkspaceValue | null>(null);

export function useNotebookWorkspace(): NotebookWorkspaceValue {
  const value = useContext(NotebookWorkspaceContext);
  if (value === null) throw new Error('useNotebookWorkspace must be used inside NotebookWorkspace');
  return value;
}
