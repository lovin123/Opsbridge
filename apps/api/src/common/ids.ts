import { randomUUID } from 'crypto';

export function newUserIdentity(id = randomUUID()): { id: string; nexconnUserId: string } {
  return {
    id,
    nexconnUserId: nexconnUserIdFromUserId(id),
  };
}

export function nexconnUserIdFromUserId(userId: string): string {
  const nexconnUserId = `u${userId.replace(/-/g, '')}`;
  if (!/^u[a-zA-Z0-9]+$/.test(nexconnUserId) || nexconnUserId.length > 64) {
    throw new Error('Unable to derive a Nexconn user id');
  }
  return nexconnUserId;
}
