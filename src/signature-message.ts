/**
 * Two formatters for the text in a refusal message.
 *
 * Split out of `signatures.ts` when it crossed the repo's 650-line ceiling.
 * Small, but the right things to move: neither touches a signature, a secret
 * or a surface — they only shape text a human is going to read — and a
 * refusal message is the whole reason this library returns a `reason` and a
 * `message` instead of a boolean.
 */

/** Sentence-case, for a message that starts with an interpolated word. */
export function capitalise(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

/**
 * Clip an untrusted header value so an error message stays one line.
 *
 * It is echoing bytes that arrived from the network into somebody's logs, so
 * the cap is not cosmetic.
 */
export function preview(value: string): string {
  return value.length > 48 ? `${value.slice(0, 47)}…` : value;
}
