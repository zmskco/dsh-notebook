/**
 * One vocabulary, one mapping.
 *
 * `ApiErrorCode` is what every failure crossing this plugin's HTTP surface
 * carries; this table turns it into the status the control plane answers with.
 */
import type { ApiErrorCode } from '../types.js'

export const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  'bad-request': 400,
  forbidden: 403,
  'not-found': 404,
  conflict: 409,
  internal: 500,
}

/**
 * The status for one error code, for a caller that already has the code.
 * @param code - the failure's code.
 * @returns the HTTP status to answer with.
 */
export function statusFor(code: ApiErrorCode): number {
  return STATUS_BY_CODE[code]
}
