import { describe, expect, it } from 'vitest';
import { detectLanguage } from './language.js';

describe('detectLanguage', () => {
  it.each([
    ['Do you have villas for rent in Sheikh Zayed?', 'en'],
    ['what is the weather today?', 'en'],
    ['شقة للإيجار في التجمع الخامس', 'ar'],
    ['عايز اشوف الوحدة التانية', 'ar'],
    ['أحمد', 'ar'],
  ])('%s => %s', (text, expected) => {
    expect(detectLanguage(text)).toBe(expected);
  });

  it('counts letters, not digits or punctuation', () => {
    expect(detectLanguage('شقة 3 غرف ٣ 5,000,000 !!!')).toBe('ar');
    expect(detectLanguage('3 bedroom apartment, 5,000,000 EGP ؟')).toBe('en');
  });

  it('treats a mixed message by its share of Arabic letters (30 percent)', () => {
    expect(detectLanguage('شقة in Zayed')).toBe('ar');
    expect(detectLanguage('فيلا for rent in Sheikh Zayed')).toBe('en');
    // 3 of 10 letters is exactly the threshold.
    expect(detectLanguage('ابج abcdefg')).toBe('ar');
    // 3 of 11 is just below it.
    expect(detectLanguage('ابج abcdefgh')).toBe('en');
  });

  it('is not fooled by an Arabic name inside an English request', () => {
    expect(
      detectLanguage('My name is محمد and I want a villa in New Cairo'),
    ).toBe('en');
  });

  it('keeps the fallback for a message without letters', () => {
    expect(detectLanguage('01001234567')).toBe('en');
    expect(detectLanguage('01001234567', 'ar')).toBe('ar');
    expect(detectLanguage('  ', 'ar')).toBe('ar');
    expect(detectLanguage('👍 2026-10-19', 'ar')).toBe('ar');
  });

  describe('inside an Arabic conversation', () => {
    it.each(['Ahmed Ali', 'ok', 'Mivida', 'Test User', 'yes please'])(
      'a short Latin message (%s) keeps Arabic',
      (text) => {
        expect(detectLanguage(text, 'ar')).toBe('ar');
      },
    );

    it.each([
      '3ayez sha2a fe New Cairo',
      '7aga hadya2 fe el Tagamoa el khames',
      'ana e3mel booking le el wa7da di ya basha',
      'ezayak momken a3rf el se3r bel tafseel',
    ])('Arabizi (%s) keeps Arabic', (text) => {
      expect(detectLanguage(text, 'ar')).toBe('ar');
    });

    it('a full English sentence switches to English', () => {
      expect(
        detectLanguage('I am looking for a villa in New Cairo', 'ar'),
      ).toBe('en');
      expect(detectLanguage('Ahmed Ali Hassan Mohamed Kamal', 'ar')).toBe('en');
    });

    it('English counts such as "3br" or "5th" are not Arabizi', () => {
      expect(
        detectLanguage('show me 3br apartments on the 5th settlement', 'ar'),
      ).toBe('en');
    });

    it('an Arabic message always wins, in either direction', () => {
      expect(detectLanguage('شقة للبيع', 'ar')).toBe('ar');
      expect(detectLanguage('شقة للبيع', 'en')).toBe('ar');
    });
  });

  it('stays English in an English conversation, whatever the message looks like', () => {
    expect(detectLanguage('ok', 'en')).toBe('en');
    expect(detectLanguage('3ayez sha2a fe New Cairo', 'en')).toBe('en');
  });
});
