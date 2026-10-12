import { describe, expect, it } from 'vitest';
import {
  cairoToday,
  checkBookingDate,
  normaliseName,
  normalisePhone,
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

describe('cairoToday', () => {
  it('uses the Cairo calendar day, not UTC', () => {
    expect(cairoToday(new Date('2026-10-11T22:30:00Z'))).toBe('2026-10-12');
    expect(cairoToday(new Date('2026-10-12T09:00:00Z'))).toBe('2026-10-12');
  });
});
