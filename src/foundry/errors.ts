/**
 * @fileoverview Error types the FoundryVTT client throws for callers to tell apart.
 */

/**
 * The caller's input is wrong — a malformed id, or one that names no document
 * — as opposed to a connection or server fault. Tool handlers report it as
 * invalid params (see `withToolError`), so the model knows to fix its call.
 */
export class InvalidInputError extends Error {
  override name = 'InvalidInputError';
}
