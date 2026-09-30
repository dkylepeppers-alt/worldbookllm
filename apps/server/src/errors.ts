export class NotFoundError extends Error {
  override readonly name = 'NotFoundError';

  constructor(message: string) {
    super(message);
  }
}

export class UnsafePathError extends Error {
  override readonly name = 'UnsafePathError';

  constructor(path: string) {
    super(`Path escapes the data directory: ${path}`);
  }
}

export class InvalidStoredDataError extends Error {
  override readonly name = 'InvalidStoredDataError';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';
  readonly code = 'configuration_error';
}

export class ConflictError extends Error {
  override readonly name = 'ConflictError';

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** A request that is well-formed but names something that cannot be used, such as a missing skill. */
export class ValidationError extends Error {
  override readonly name = 'ValidationError';
}

export class InvalidImportError extends Error {
  override readonly name = 'InvalidImportError';
}

/**
 * A story CLI invocation that could not do what was asked. `exitCode` is the
 * CLI's own (2 usage error, 3 unusable project, 4 write refused, …) and the
 * message is its output with the book root rewritten to `.`.
 */
export class StoryCommandError extends Error {
  override readonly name = 'StoryCommandError';

  constructor(
    readonly exitCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** A book path the app will not write: not Markdown, a generated registry, or build output. */
export class ReadOnlyBookPathError extends Error {
  override readonly name = 'ReadOnlyBookPathError';

  constructor(path: string, reason: string) {
    super(`${path} cannot be written: ${reason}`);
  }
}
