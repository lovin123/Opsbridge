import { isAllowedOrigin } from './origin';

describe('origin checks', () => {
  const allowed = ['http://localhost:3000'];

  it('allows non-browser requests that omit Origin', () => {
    expect(isAllowedOrigin(undefined, allowed)).toBe(true);
  });

  it('allows the configured web origin', () => {
    expect(isAllowedOrigin('http://localhost:3000', allowed)).toBe(true);
  });

  it('rejects a foreign origin', () => {
    expect(isAllowedOrigin('https://evil.example', allowed)).toBe(false);
  });
});
