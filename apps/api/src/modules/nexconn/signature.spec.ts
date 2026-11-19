import { newNonce, nexconnSignature, signaturesMatch } from './signature';

describe('Nexconn signatures', () => {
  it('matches the documented sha1(secret + nonce + timestamp)', () => {
    const signature = nexconnSignature('secret', '14314', '1408710653491');
    expect(signature).toMatch(/^[a-f0-9]{40}$/);
    expect(signaturesMatch(signature, signature)).toBe(true);
    expect(signaturesMatch(signature, '0'.repeat(40))).toBe(false);
  });

  it('issues an 18-character nonce', () => {
    expect(newNonce()).toHaveLength(18);
  });
});
