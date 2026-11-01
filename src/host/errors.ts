/**
 * The single error type crossing the HTTP and tool boundaries.
 *
 * A failure carries a stable machine-readable code so the UI can react to the
 * kind of problem rather than to message text, and so the model reading a tool
 * result gets the same vocabulary the page shows.
 */
import type { ApiErrorCode } from './types.js'

export class NotebookError extends Error {
  readonly code: ApiErrorCode

  constructor(code: ApiErrorCode, message: string) {
    super(message)
    this.name = 'NotebookError'
    this.code = code
  }
}

/**
 * Narrow an unknown rejection into a `NotebookError`.
 * @param error - the caught value.
 * @param fallback - message used when the value carries no usable text.
 * @returns the value itself when it already is a `NotebookError`, else a wrapped one.
 */
export function asNotebookError(error: unknown, fallback = 'unexpected failure'): NotebookError {
  if (error instanceof NotebookError) return error
  const message = error instanceof Error && error.message.length > 0 ? error.message : fallback
  return new NotebookError('internal', message)
}
