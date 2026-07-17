import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SourceOrganizationFields } from './SourceOrganizationFields.js';

describe('SourceOrganizationFields', () => {
  it('renders editable category, tags, loading, warning, and retry controls', async () => {
    const onCategoryChange = vi.fn();
    const onTagsChange = vi.fn();
    const onSuggestAgain = vi.fn();
    function Harness({ loading, warning }: { loading: boolean; warning: string | null }) {
      const [category, setCategory] = useState<'places' | 'factions'>('places');
      const [tags, setTags] = useState('glass-marsh');

      return (
        <SourceOrganizationFields
          idPrefix="draft-0"
          category={category}
          tags={tags}
          loading={loading}
          warning={warning}
          disabled={false}
          onCategoryChange={(value) => {
            onCategoryChange(value);
            if (value === 'places' || value === 'factions') setCategory(value);
          }}
          onTagsChange={(value) => {
            onTagsChange(value);
            setTags(value);
          }}
          onSuggestAgain={onSuggestAgain}
        />
      );
    }
    const { rerender } = render(<Harness loading warning={null} />);
    expect(screen.getByRole('status').textContent).toContain('Classifying');
    rerender(
      <Harness
        loading={false}
        warning="Couldn't suggest organization. You can choose it manually."
      />,
    );
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Category'), 'factions');
    await user.clear(screen.getByLabelText('Tags'));
    await user.type(screen.getByLabelText('Tags'), 'iron-compact');
    await user.click(screen.getByRole('button', { name: 'Suggest again' }));
    expect(onCategoryChange).toHaveBeenCalledWith('factions');
    expect(onTagsChange).toHaveBeenLastCalledWith('iron-compact');
    expect(onSuggestAgain).toHaveBeenCalledOnce();
  });
});
