export function isAllowedOrigin(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) {
    return true;
  }

  return allowed.includes(origin);
}
