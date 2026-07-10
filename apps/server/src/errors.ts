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
