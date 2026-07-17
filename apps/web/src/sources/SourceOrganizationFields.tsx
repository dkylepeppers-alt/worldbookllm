import { SOURCE_CATEGORIES, type SourceCategory } from '@worldbookllm/shared';

interface SourceOrganizationFieldsProps {
  idPrefix: string;
  labelSuffix?: string;
  category: SourceCategory | null;
  tags: string;
  loading: boolean;
  warning: string | null;
  disabled: boolean;
  onCategoryChange(value: SourceCategory | null): void;
  onTagsChange(value: string): void;
  onSuggestAgain(): void;
}

export function SourceOrganizationFields(props: SourceOrganizationFieldsProps) {
  return (
    <section className="source-organization-editor" aria-label="Source organization">
      <div className="source-organization-heading">
        <p className="coordinate-label">Organization</p>
        {props.loading ? <span role="status">Classifying…</span> : null}
      </div>
      <div className="source-organization-fields">
        <div>
          <label htmlFor={`${props.idPrefix}-category`}>Category{props.labelSuffix ?? ''}</label>
          <select
            id={`${props.idPrefix}-category`}
            disabled={props.disabled}
            value={props.category ?? ''}
            onChange={(event) =>
              props.onCategoryChange(
                event.target.value === '' ? null : (event.target.value as SourceCategory),
              )
            }
          >
            <option value="">None</option>
            {SOURCE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${props.idPrefix}-tags`}>Tags{props.labelSuffix ?? ''}</label>
          <input
            id={`${props.idPrefix}-tags`}
            disabled={props.disabled}
            placeholder="Comma-separated, e.g. iron-compact, smugglers"
            value={props.tags}
            onChange={(event) => props.onTagsChange(event.target.value)}
          />
        </div>
      </div>
      {props.warning === null ? null : (
        <p className="source-organization-warning">{props.warning}</p>
      )}
      <button
        type="button"
        className="button-link"
        disabled={props.disabled || props.loading}
        onClick={props.onSuggestAgain}
      >
        Suggest again
      </button>
    </section>
  );
}
