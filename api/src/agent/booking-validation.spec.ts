import { describe, expect, it } from 'vitest';
import {
  businessToday,
  checkBookingDate,
  checkBookingTime,
  interpretTimeAnswer,
  normaliseName,
  normalisePhone,
  normaliseTime,
  weekdayOf,
} from './booking-validation.js';

describe('normalisePhone', () => {
  it.each([
    ['01001234567', '01001234567'],
    ['0100 123 4567', '01001234567'],
    ['010-0123-4567', '01001234567'],
    ['+201001234567', '+201001234567'],
    ['+20 100 123 4567', '+201001234567'],
    ['01112345678', '01112345678'],
    ['01212345678', '01212345678'],
    ['01512345678', '01512345678'],
    ['٠١٠٠١٢٣٤٥٦٧', '01001234567'],
  ])('accepts %s', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected);
  });

  it.each([
    '',
    '12345678901',
    '0100123456',
    '010012345678',
    '01301234567',
    '+211001234567',
    '0020100123456',
    'call me',
  ])('rejects %j', (raw) => {
    expect(normalisePhone(raw)).toBeNull();
  });
});

describe('normaliseName', () => {
  it('trims and collapses whitespace', () => {
    expect(normaliseName('  Test   User ')).toBe('Test User');
  });

  it('rejects empty, one-letter and overlong names', () => {
    expect(normaliseName(' ')).toBeNull();
    expect(normaliseName('A')).toBeNull();
    expect(normaliseName('x'.repeat(81))).toBeNull();
  });
});

describe('checkBookingDate', () => {
  const today = '2026-10-12';

  it('accepts tomorrow up to 90 days ahead', () => {
    expect(checkBookingDate('2026-10-13', today)).toBe('ok');
    expect(checkBookingDate('2027-01-10', today)).toBe('ok');
  });

  it('rejects today and the past', () => {
    expect(checkBookingDate('2026-10-12', today)).toBe('not_future');
    expect(checkBookingDate('2026-01-01', today)).toBe('not_future');
  });

  it('rejects dates beyond 90 days', () => {
    expect(checkBookingDate('2027-01-11', today)).toBe('too_far');
  });

  it.each(['next sunday', '2026-13-01', '2026-02-30', '12/10/2026', ''])(
    'rejects the unreadable date %j',
    (value) => {
      expect(checkBookingDate(value, today)).toBe('invalid');
    },
  );
});

describe('businessToday', () => {
  it('uses the calendar day of the business time zone, not UTC', () => {
    const cairo = 'Africa/Cairo';
    expect(businessToday(new Date('2026-10-11T22:30:00Z'), cairo)).toBe(
      '2026-10-12',
    );
    expect(businessToday(new Date('2026-10-12T09:00:00Z'), cairo)).toBe(
      '2026-10-12',
    );
  });

  it('follows APP_TIMEZONE', () => {
    const instant = new Date('2026-10-12T22:30:00Z');
    expect(businessToday(instant, 'Africa/Cairo')).toBe('2026-10-13');
    expect(businessToday(instant, 'UTC')).toBe('2026-10-12');
    expect(businessToday(instant, 'America/Los_Angeles')).toBe('2026-10-12');
    expect(businessToday(instant, 'Pacific/Kiritimati')).toBe('2026-10-13');
  });
});

describe('weekdayOf', () => {
  it('names the weekday of a calendar date, independent of the host zone', () => {
    expect(weekdayOf('2026-10-12')).toBe('Monday');
    expect(weekdayOf('2026-10-19')).toBe('Monday');
    expect(weekdayOf('2026-10-17')).toBe('Saturday');
  });

  it('is null for an unreadable date', () => {
    expect(weekdayOf('next monday')).toBeNull();
    expect(weekdayOf('2026-02-30')).toBeNull();
  });
});

describe('normaliseTime', () => {
  it.each([
    ['17:00', '17:00'],
    ['9:30', '09:30'],
    ['09:05', '09:05'],
    ['17:00:00', '17:00'],
    [' 21:00 ', '21:00'],
    ['00:00', '00:00'],
    ['١٧:٠٠', '17:00'],
  ])('reads %j as %s', (raw, expected) => {
    expect(normaliseTime(raw)).toBe(expected);
  });

  it.each(['', '5pm', '17', '17.30', '24:00', '12:60', '99:99', 'noon', '1:2'])(
    'rejects %j',
    (raw) => {
      expect(normaliseTime(raw)).toBeNull();
    },
  );
});

describe('checkBookingTime', () => {
  it.each([
    ['09:00', '09:00'],
    ['9:00', '09:00'],
    ['12:30', '12:30'],
    ['17:00', '17:00'],
    ['21:00', '21:00'],
  ])('accepts %s inside the 09:00-21:00 viewing hours', (raw, time) => {
    expect(checkBookingTime(raw)).toEqual({ status: 'ok', time });
  });

  it.each(['08:59', '00:00', '06:00', '21:01', '22:30', '23:59'])(
    'rejects %s as outside the viewing hours',
    (raw) => {
      expect(checkBookingTime(raw)).toEqual({ status: 'outside_hours' });
    },
  );

  it.each(['', 'evening', '24:00', '17:75'])(
    'rejects the unreadable time %j',
    (raw) => {
      expect(checkBookingTime(raw)).toEqual({ status: 'invalid' });
    },
  );
});

describe('interpretTimeAnswer', () => {
  it('says nothing when the latest message has no time', () => {
    expect(interpretTimeAnswer({})).toEqual({ kind: 'none' });
    expect(
      interpretTimeAnswer({ preferredTime: '  ', anyTime: false }),
    ).toEqual({ kind: 'none' });
  });

  it('normalises a valid time', () => {
    expect(interpretTimeAnswer({ preferredTime: '9:30' })).toEqual({
      kind: 'time',
      time: '09:30',
    });
  });

  it('lets an explicit "any time" win over any preferredTime, even a garbage one', () => {
    for (const preferredTime of ['anyTime', '17:00', '25:00', '23:00']) {
      expect(interpretTimeAnswer({ preferredTime, anyTime: true })).toEqual({
        kind: 'any',
      });
    }
    expect(interpretTimeAnswer({ anyTime: true, timeVague: true })).toEqual({
      kind: 'any',
    });
  });

  it('never stores a vague time of day', () => {
    expect(interpretTimeAnswer({ timeVague: true })).toEqual({
      kind: 'problem',
      problem: 'vague',
    });
    expect(
      interpretTimeAnswer({ preferredTime: '18:00', timeVague: true }),
    ).toEqual({ kind: 'problem', problem: 'vague' });
  });

  it('reports the specific problem of a bad time', () => {
    expect(interpretTimeAnswer({ preferredTime: 'anyTime' })).toEqual({
      kind: 'problem',
      problem: 'invalid',
    });
    expect(interpretTimeAnswer({ preferredTime: '22:00' })).toEqual({
      kind: 'problem',
      problem: 'outside_hours',
    });
  });
});
