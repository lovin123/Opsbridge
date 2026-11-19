import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export function nexconnSignature(secret: string, nonce: string, timestamp: string): string {
  return createHash('sha1').update(`${secret}${nonce}${timestamp}`).digest('hex');
}

export function newNonce(): string {
  return randomBytes(9).toString('hex');
}

export function signaturesMatch(expected: string, received: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
