export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');

  return slug || 'organization';
}

export function nextSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    return base;
  }

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base.slice(0, 44)}-${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }

  throw new Error('Unable to allocate an organization slug');
}
