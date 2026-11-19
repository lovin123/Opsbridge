import { nextSlug, slugify } from './slug';

describe('organization slugs', () => {
  it('slugifies a company name', () => {
    expect(slugify('ABC Facilities Management')).toBe('abc-facilities-management');
  });

  it('falls back when the name has no letters or numbers', () => {
    expect(slugify('   ---  ')).toBe('organization');
  });

  it('appends a numeric suffix when the slug is taken', () => {
    expect(nextSlug('abc', new Set(['abc', 'abc-2']))).toBe('abc-3');
  });
});
