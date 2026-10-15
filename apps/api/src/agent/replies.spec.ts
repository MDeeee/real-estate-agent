import { describe, expect, it } from 'vitest';
import type { BookingSummary } from '../bookings/bookings.service.js';
import { readCatalogs } from '../i18n/catalogs.js';
import { createTestI18n, createTestReplies } from '../testing/replies.js';
import { formatCalendarDate, formatList } from './replies.js';

const replies = createTestReplies();
const i18n = createTestI18n();

const booking: BookingSummary = {
  id: 'cmbooking000000000000001',
  reference: '00000001',
  propertySlug: 'alpha',
  propertyTitle: 'Alpha',
  name: 'Test User',
  phone: '01001234567',
  preferredDate: '2026-10-19',
  preferredTime: '17:00',
  status: 'CONFIRMED',
};

function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('catalogs', () => {
  it('have the same keys in English and Arabic, except plural forms', () => {
    const catalogs = readCatalogs();
    const withoutPlurals = (language: string) =>
      keysOf(catalogs[language])
        .filter(
          (key) =>
            !key.startsWith('agent.days.') &&
            !key.startsWith('agent.ordinalBeyond.'),
        )
        .sort();
    expect(withoutPlurals('ar')).toEqual(withoutPlurals('en'));
  });
});

describe('the "N days" plural', () => {
  const days = (lang: 'en' | 'ar', count: number) =>
    i18n.t('agent.days', { lang, args: { count } });

  it('uses the Arabic form that Intl.PluralRules picks for the count', () => {
    expect(days('ar', 1)).toBe('يوم');
    expect(days('ar', 2)).toBe('يومين');
    expect(days('ar', 3)).toBe('3 أيام');
    expect(days('ar', 10)).toBe('10 أيام');
    expect(days('ar', 11)).toBe('11 يوم');
    expect(days('ar', 30)).toBe('30 يوم');
    expect(days('ar', 100)).toBe('100 يوم');
  });

  it('uses singular and plural in English', () => {
    expect(days('en', 1)).toBe('1 day');
    expect(days('en', 2)).toBe('2 days');
    expect(days('en', 30)).toBe('30 days');
  });

  it('puts the booking window into the date question and the too-far problem', () => {
    expect(
      replies.bookingQuestion('en', undefined, ['preferredDate'], []),
    ).toBe(
      'To book a viewing I still need your preferred viewing date (within the next 90 days).',
    );
    expect(
      replies.bookingQuestion('ar', undefined, [], ['date_too_far']),
    ).toContain('الحجز متاح حتى 90 يوم قدّام.');
  });
});

describe('formatList', () => {
  it('joins with the language conjunction', () => {
    expect(formatList(['a'], 'en')).toBe('a');
    expect(formatList(['a', 'b'], 'en')).toBe('a and b');
    expect(formatList(['a', 'b', 'c'], 'en')).toBe('a, b and c');
    expect(formatList(['أ', 'ب'], 'ar')).toBe('أ وب');
    expect(formatList(['أ', 'ب', 'ج'], 'ar')).toBe('أ وب وج');
  });

  it('is used for the missing booking details', () => {
    expect(replies.bookingQuestion('en', 'Alpha', ['name', 'phone'], [])).toBe(
      'To book a viewing of "Alpha", I still need your full name and your mobile number (e.g. 01001234567).',
    );
  });
});

describe('formatCalendarDate', () => {
  it('never shifts the calendar day, whatever the process time zone', () => {
    expect(formatCalendarDate('2026-10-19', 'en')).toBe(
      'Monday, 19 October 2026',
    );
    expect(formatCalendarDate('2026-01-01', 'en')).toBe(
      'Thursday, 1 January 2026',
    );
    expect(formatCalendarDate('2026-12-31', 'en')).toBe(
      'Thursday, 31 December 2026',
    );
  });

  it('formats in Arabic (Egypt)', () => {
    expect(formatCalendarDate('2026-10-19', 'ar')).toBe(
      'الاثنين، 19 أكتوبر 2026',
    );
  });
});

describe('bookingConfirmation', () => {
  it('confirms in English with a long date and the unchanged time, reference and phone', () => {
    expect(replies.bookingConfirmation('en', booking, true)).toBe(
      'Your viewing is confirmed: "Alpha" on Monday, 19 October 2026 at 17:00 for Test User. Booking reference: 00000001. We will call you on 01001234567 if anything changes.',
    );
  });

  it('confirms in Arabic', () => {
    expect(replies.bookingConfirmation('ar', booking, true)).toBe(
      'تم تأكيد معاينتك: "Alpha" يوم الاثنين، 19 أكتوبر 2026 الساعة 17:00 باسم Test User. رقم الحجز: 00000001. هنتصل بك على 01001234567 لو حصل أي تغيير.',
    );
  });

  it.each(['en', 'ar'] as const)(
    'inserts user values verbatim, never through the template engine (%s)',
    (lang) => {
      const evil = '$t(agent.smalltalk) {name} {phone}';
      const text = replies.bookingConfirmation(
        lang,
        { ...booking, propertyTitle: evil, name: evil },
        true,
      );
      expect(text.split(evil)).toHaveLength(3);
      expect(text).not.toContain(replies.smalltalk(lang));
      const question = replies.bookingQuestion(
        lang,
        evil,
        ['property', 'name'],
        [],
        [evil],
      );
      expect(question.split(evil)).toHaveLength(3);
      expect(question).not.toContain(replies.smalltalk(lang));
    },
  );

  it('says so when the viewing already existed or has no time', () => {
    const text = replies.bookingConfirmation(
      'en',
      { ...booking, preferredTime: null },
      false,
    );
    expect(text).toContain('This viewing was already booked and is confirmed');
    expect(text).toContain('19 October 2026 (any time)');
  });
});

describe('ordinalBeyondResults', () => {
  it('says how many listings the last search found, plural-aware, in both languages', () => {
    expect(replies.ordinalBeyondResults('en', ['Alpha'])).toBe(
      'Your last search found only 1 listing: "Alpha". Did you mean that one?',
    );
    expect(replies.ordinalBeyondResults('en', ['Alpha', 'Beta'])).toBe(
      'Your last search found only 2 listings: "Alpha"; "Beta". Which of these did you mean?',
    );
    expect(replies.ordinalBeyondResults('ar', ['ألفا'])).toContain('"ألفا"');
    expect(replies.ordinalBeyondResults('ar', ['ألفا'])).toContain('وحدة واحدة');
  });

  it('never runs the template engine over a title', () => {
    expect(replies.ordinalBeyondResults('en', ['$t(agent.smalltalk)'])).toContain(
      '"$t(agent.smalltalk)"',
    );
  });
});
