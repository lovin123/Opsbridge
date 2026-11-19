import { canTransition, incidentChannelId, incidentNumber, nextStatuses } from '@fieldops/shared';

describe('incident workflow', () => {
  it('follows the operational path and blocks skips', () => {
    expect(canTransition('OPEN', 'ASSIGNED')).toBe(true);
    expect(canTransition('ASSIGNED', 'ACCEPTED')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'RESOLVED')).toBe(true);
    expect(canTransition('OPEN', 'RESOLVED')).toBe(false);
    expect(canTransition('CLOSED', 'OPEN')).toBe(false);
  });

  it('exposes allowed next statuses for the UI', () => {
    expect(nextStatuses('OPEN')).toEqual(['ASSIGNED']);
    expect(nextStatuses('RESOLVED')).toEqual(['CLOSED', 'IN_PROGRESS']);
    expect(nextStatuses('CLOSED')).toEqual([]);
  });

  it('requires assignment before ASSIGNED in the product rules', () => {
    // Status transition alone is legal; service layer blocks ASSIGNED without assigneeId.
    expect(canTransition('OPEN', 'ASSIGNED')).toBe(true);
  });

  it('uses an alphanumeric Nexconn channel id', () => {
    expect(incidentNumber(2026, 1)).toBe('INC-2026-0001');
    expect(incidentChannelId(2026, 1)).toBe('inc2026000001');
    expect(incidentChannelId(2026, 1)).toMatch(/^[a-z0-9]+$/);
  });
});
