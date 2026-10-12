import { createHmac } from 'node:crypto';

/**
 * Compute the `userHash` the widget needs for identity verification.
 *
 * When a workspace turns identity verification on, the widget must prove the
 * `externalId` it claims was issued by the customer's backend rather than
 * typed into a browser console — otherwise anyone can open a chat as anyone
 * else's account. This is the backend half of that handshake:
 *
 *   const userHash = chatlyIdentityHash(process.env.CHATLY_IDV_SECRET, user.id);
 *   // then render:
 *   // Chatly('identify', { externalId: user.id, userHash, email: user.email })
 *
 * It lived in the API's own source as a comment-only snippet, where the
 * people who need it — customers integrating their backend — could never
 * import it.
 *
 * The secret is the workspace's identity-verification secret. It must never
 * reach the browser; only the digest does.
 */
export function chatlyIdentityHash(secret: string, externalId: string): string {
  if (secret.length === 0) {
    throw new Error('chatlyIdentityHash: secret is empty');
  }
  if (externalId.length === 0) {
    throw new Error('chatlyIdentityHash: externalId is empty');
  }
  return createHmac('sha256', secret).update(externalId).digest('hex');
}
