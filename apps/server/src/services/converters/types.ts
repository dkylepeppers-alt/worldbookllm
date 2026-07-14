import type { SourcePreviewFormat } from '@worldbookllm/shared';

export interface PreviewEntry {
  title: string;
  markdown: string;
}

export interface ConversionResult {
  format: SourcePreviewFormat;
  mediaType: string;
  entries: PreviewEntry[];
  conversionNotes: string[];
}
