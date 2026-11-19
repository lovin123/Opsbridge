import type { Response } from 'express';

export function setSessionCookie(
  response: Response,
  name: string,
  token: string,
  ttlHours: number,
  secure: boolean,
): void {
  response.cookie(name, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: ttlHours * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(response: Response, name: string, secure: boolean): void {
  response.clearCookie(name, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
  });
}
