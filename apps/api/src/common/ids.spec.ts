import { nexconnUserIdFromUserId } from './ids';

describe('nexconn user ids', () => {
  it('derives an alphanumeric id from a user uuid', () => {
    const userId = '550e8400-e29b-41d4-a716-446655440000';
    const nexconnUserId = nexconnUserIdFromUserId(userId);

    expect(nexconnUserId).toBe('u550e8400e29b41d4a716446655440000');
    expect(nexconnUserId).toMatch(/^u[a-z0-9]+$/);
    expect(nexconnUserId.length).toBeLessThanOrEqual(64);
  });
});
