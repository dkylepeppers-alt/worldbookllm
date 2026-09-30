import type { BookTree } from '@worldbookllm/shared';
import { createContext, useContext } from 'react';

export interface BookContextValue {
  slug: string;
  tree: BookTree;
  /** Refetches the tree after anything changed the book's files. */
  reload: () => void;
}

export const BookContext = createContext<BookContextValue | null>(null);

export function useBook(): BookContextValue {
  const value = useContext(BookContext);
  if (value === null) throw new Error('useBook must be used inside a book route');
  return value;
}
