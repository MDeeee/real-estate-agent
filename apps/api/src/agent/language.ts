import type { Language } from '../llm/agent-model.js';

/** Share of Arabic-script letters from which a message counts as Arabic. */
export const ARABIC_SHARE_THRESHOLD = 0.3;

/**
 * In an Arabic conversation a message with fewer letters than this ("ok", a
 * name, a compound name) is too short to say anything: it keeps the language.
 */
export const SHORT_MESSAGE_LETTERS = 15;

const LETTER = /\p{L}/gu;
const ARABIC_LETTER = /\p{Script=Arabic}/gu;

/** "3ayez", "sha2a", "7aga": a Latin word with an Arabizi digit inside it. */
const ARABIZI_DIGIT_WORD = /^(?=\d*[a-z])(?=[a-z]*[235789])[a-z0-9]{3,}$/i;
/** "3br", "5th", "2bed": a count with its unit, not Arabizi. */
const COUNT_WITH_UNIT =
  /^\d+(?:st|nd|rd|th|br|bd|bed|beds|bedroom|bedrooms|bath|baths|m|m2|sqm|k|mn|million|egp)$/i;
/** Arabizi words that contain no digit. */
const ARABIZI_WORDS = new Set([
  'ahlan',
  'ahlen',
  'aywa',
  'aiwa',
  'ezay',
  'ezayak',
  'feen',
  'fein',
  'habibi',
  'keda',
  'kda',
  'kwayes',
  'kwayyes',
  'lesa',
  'malesh',
  'mashi',
  'mesh',
  'momken',
  'mumkin',
  'shokran',
  'shukran',
  'tamam',
  'yalla',
  'yaany',
]);

function looksLikeArabizi(text: string): boolean {
  return text
    .split(/[^\p{L}\p{N}]+/u)
    .some(
      (word) =>
        ARABIZI_WORDS.has(word.toLowerCase()) ||
        (ARABIZI_DIGIT_WORD.test(word) && !COUNT_WITH_UNIT.test(word)),
    );
}

/**
 * The language to reply in, decided from the visitor's latest message and the
 * language of the conversation so far (a small LLM classifier proved
 * unreliable at it):
 *
 * - Arabic when at least 30 percent of the message's letters are Arabic-script
 *   (digits, punctuation and emoji are not letters);
 * - otherwise Arabic still, in a conversation that is already Arabic, when the
 *   message is too short to tell (fewer than 15 letters: "ok", a name) or is
 *   written in Arabizi ("3ayez sha2a fe New Cairo");
 * - otherwise English. A message without any letter keeps `current`.
 */
export function detectLanguage(
  text: string,
  current: Language = 'en',
): Language {
  const letters = text.match(LETTER)?.length ?? 0;
  if (letters === 0) return current;
  const arabic = text.match(ARABIC_LETTER)?.length ?? 0;
  if (arabic / letters >= ARABIC_SHARE_THRESHOLD) return 'ar';
  if (
    current === 'ar' &&
    (letters < SHORT_MESSAGE_LETTERS || looksLikeArabizi(text))
  ) {
    return 'ar';
  }
  return 'en';
}
