import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { conversationGroupFor, formatRelativeTime } from './conversation-time';

describe('conversation-time', () => {
  it('formats sub-minute gaps as "ahora"', () => {
    const now = Date.parse('2026-08-06T12:00:00.000Z');
    assert.equal(formatRelativeTime(now - 10_000, now), 'ahora');
  });

  it('formats minute and hour gaps', () => {
    const now = Date.parse('2026-08-06T12:00:00.000Z');
    assert.equal(formatRelativeTime(now - 2 * 60_000, now), 'hace 2 min');
    assert.equal(formatRelativeTime(now - 3 * 3_600_000, now), 'hace 3 h');
  });

  it('groups same-calendar-day timestamps as Hoy regardless of hour', () => {
    const now = new Date(2026, 7, 6, 23, 50).getTime();
    const earlierToday = new Date(2026, 7, 6, 0, 5).getTime();
    assert.equal(conversationGroupFor(earlierToday, now), 'Hoy');
  });

  it('groups yesterday and older correctly', () => {
    const now = new Date(2026, 7, 6, 12, 0).getTime();
    const yesterday = new Date(2026, 7, 5, 23, 59).getTime();
    const lastWeek = new Date(2026, 6, 30, 12, 0).getTime();
    assert.equal(conversationGroupFor(yesterday, now), 'Ayer');
    assert.equal(conversationGroupFor(lastWeek, now), 'Anteriores');
  });
});
