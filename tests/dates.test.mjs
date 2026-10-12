import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWallClock, toDisplayDateTime, toIsoDay } from '../dist/utils/dates.js';

test('toIsoDay reads instants on the Turkey calendar and keeps wall-clock days', () => {
  // A day stored as Turkey midnight comes back as the previous evening in UTC.
  assert.equal(toIsoDay('2026-09-30T21:00:00.000+00:00'), '2026-10-01');
  assert.equal(toIsoDay('2026-10-01T00:00:00.000+00:00'), '2026-10-01');
  assert.equal(toIsoDay('2026-10-01T03:00:00.000+03:00'), '2026-10-01');
  assert.equal(toIsoDay('2026-09-30T21:00:00Z'), '2026-10-01');
  assert.equal(toIsoDay(Date.UTC(2026, 8, 30, 21, 0)), '2026-10-01');
  assert.equal(toIsoDay('2026-10-01'), '2026-10-01');
  assert.equal(toIsoDay('2026-10-01 23:30'), '2026-10-01');
  assert.equal(toIsoDay(''), undefined);
  assert.equal(toIsoDay(null), undefined);
  assert.equal(toIsoDay(Number.NaN), undefined);
});

test('toDisplayDateTime shows instants as Turkey wall clock and leaves wall-clock strings alone', () => {
  assert.equal(toDisplayDateTime('2026-10-01T06:00:00.000+00:00'), '2026-10-01 09:00');
  assert.equal(toDisplayDateTime('2026-10-01T09:00:00.000+03:00'), '2026-10-01 09:00');
  assert.equal(toDisplayDateTime(Date.UTC(2026, 9, 1, 6, 0)), '2026-10-01 09:00');
  assert.equal(toDisplayDateTime('2026-10-01 09:00'), '2026-10-01 09:00');
  assert.equal(toDisplayDateTime(undefined), undefined);
});

test('parseWallClock never shifts the time and rejects offsets and impossible dates', () => {
  assert.deepEqual(parseWallClock('2026-11-02', 'start'), { date: '2026-11-02', time: undefined });
  assert.deepEqual(parseWallClock('2026-11-02 09:30', 'start'), { date: '2026-11-02', time: '09:30' });
  assert.deepEqual(parseWallClock('2026-11-02T23:59:00', 'end'), { date: '2026-11-02', time: '23:59' });
  assert.throws(() => parseWallClock('2026-11-02T09:00:00Z', 'start'), /Turkey local time/);
  assert.throws(() => parseWallClock('2026-02-30', 'start'), /not a real calendar date/);
  assert.throws(() => parseWallClock('2026-11-02 24:00', 'end'), /invalid time/);
});
