# Preset schema version 1

This document is the normative authoring contract for portable worldbookllm preset JSON. A portable preset contains prompt modules and generation controls. Server-owned fields such as `id`, `createdAt`, and `updatedAt` are not part of an import file.

## Root shape

```json
{
  "schemaVersion": 1,
  "name": "Continuity check",
  "generation": {
    "temperature": 0.3,
    "topP": null,
    "maxTokens": 4096,
    "assistantPrefill": null
  },
  "modules": [
    {
      "key": "sources",
      "name": "Selected sources",
      "kind": "sources",
      "role": "system",
      "content": null,
      "enabled": true,
      "insertion": { "position": "before_history" }
    }
  ]
}
```

The root is a strict JSON object with exactly these fields:

| Field           | Contract                                                  |
| --------------- | --------------------------------------------------------- |
| `schemaVersion` | Required. Must be the number `1`.                         |
| `name`          | Required string. Trimmed length must be 1–200 characters. |
| `generation`    | Required strict generation-controls object.               |
| `modules`       | Required ordered array containing at most 100 modules.    |

## Generation controls and null semantics

The `generation` object is strict and all four fields are required.

| Field              | Contract                                                                   | Meaning of `null`                    |
| ------------------ | -------------------------------------------------------------------------- | ------------------------------------ |
| `temperature`      | Number from 0 through 2, inclusive, in increments of 0.05. Never nullable. | Not applicable.                      |
| `topP`             | Number greater than 0 and no greater than 1, or `null`.                    | Use the provider/model default.      |
| `maxTokens`        | Integer from 1 through 131072, or `null`.                                  | Use the provider/model default.      |
| `assistantPrefill` | String of at most 32768 characters, or `null`.                             | Do not request an assistant prefill. |

Assistant prefill is provider-dependent: a provider may ignore it or reject it. An empty string is an explicit, enabled-but-blank prefill; it is distinct from `null`.

## Modules

Every preset module has a `key`, `name`, `kind`, `role`, `content`, `enabled`, and `insertion`. A preset must contain exactly one Sources module. Module array order is significant.

Across the complete array:

- There may be no more than 100 modules.
- Every `key` must be unique, including the protected `sources` key.
- The combined length of all custom-module `content` strings must not exceed 1000000 characters.
- Every module `name` is trimmed and must contain 1–200 characters.

### Custom module

```json
{
  "key": "continuity-rules",
  "name": "Continuity rules",
  "kind": "custom",
  "role": "system",
  "content": "Prefer established facts and identify contradictions.",
  "enabled": true,
  "insertion": { "position": "before_history" }
}
```

- `key` must match `^[a-z0-9][a-z0-9_-]{0,63}$`: 1–64 lowercase ASCII letters, digits, underscores, or hyphens, beginning with a letter or digit.
- `kind` must be `"custom"`.
- `role` must be `"system"`, `"user"`, or `"assistant"`.
- `content` is a string of at most 100000 characters.
- `enabled` is a boolean. When it is `true`, `content` must contain at least one non-whitespace character. Disabled modules may have blank content.

### Protected Sources module

```json
{
  "key": "sources",
  "name": "Selected sources",
  "kind": "sources",
  "role": "system",
  "content": null,
  "enabled": true,
  "insertion": { "position": "before_history" }
}
```

The Sources module represents source excerpts selected by the active chat. Its invariants are fixed: `key` is `"sources"`, `kind` is `"sources"`, `role` is `"system"`, `content` is `null`, and `enabled` is `true`. Its name and insertion may be authored. It cannot be omitted, duplicated, disabled, converted to another role, or supplied with authored content.

## Insertion, depth, and order

`insertion` is one of two strict shapes:

```json
{ "position": "before_history" }
```

```json
{ "position": "at_depth", "depth": 2 }
```

`depth` must be a non-negative integer and is allowed only for `at_depth`.

Enabled `before_history` modules are emitted before conversation history in their module-array order. An `at_depth` module is inserted at the history boundary `max(0, historyLength - depth)`:

- depth 0 is after all existing history and immediately before the newest user message;
- depth 1 is before the most recent eligible history message;
- larger depths move toward the beginning of history;
- a depth greater than the available history collapses to the boundary before all history.

Modules that resolve to the same boundary retain their module-array order. Disabled custom modules emit nothing but retain their array position for later editing.

## Validation and versioning

Validation is strict at the root and in every nested object. Unknown fields are rejected. Missing required fields, wrong JSON types, invalid enum values, invalid limits, duplicate keys, extra or missing Sources modules, and unsupported `schemaVersion` values are errors. A future schema version must not be interpreted as version 1.

The native importer accepts only files whose name ends in `.json` (case-insensitive) and whose `File.size` is no greater than 1048576 bytes (1 MiB). It reads and parses the file locally, validates the complete object, and creates nothing until the user saves a valid review.

Preset names are unique case-insensitively on the server. On create, a collision is resolved by returning a suffixed name such as `Continuity check (2)`, then `(3)`, and so on. The base is shortened when necessary so the result remains at most 200 characters. Importing a preset never changes the global default.

## Complete valid example

```json
{
  "schemaVersion": 1,
  "name": "Grounded scene draft",
  "generation": {
    "temperature": 0.75,
    "topP": 0.9,
    "maxTokens": 4096,
    "assistantPrefill": "Scene:"
  },
  "modules": [
    {
      "key": "assistant-role",
      "name": "Assistant role",
      "kind": "custom",
      "role": "system",
      "content": "You are a creative writing assistant working from established canon.",
      "enabled": true,
      "insertion": { "position": "before_history" }
    },
    {
      "key": "sources",
      "name": "Selected sources",
      "kind": "sources",
      "role": "system",
      "content": null,
      "enabled": true,
      "insertion": { "position": "before_history" }
    },
    {
      "key": "scene-style",
      "name": "Scene style",
      "kind": "custom",
      "role": "system",
      "content": "Use concrete sensory detail and preserve every stated fact.",
      "enabled": true,
      "insertion": { "position": "at_depth", "depth": 1 }
    }
  ]
}
```
