import type { BookingSummary } from '../bookings/bookings.service.js';
import type { Language } from '../llm/agent-model.js';
import { MAX_BOOKING_DAYS_AHEAD } from './booking-validation.js';

type Localised = Record<Language, string>;

function pick(language: Language, texts: Localised): string {
  return texts[language];
}

export function smalltalkReply(language: Language): string {
  return pick(language, {
    en: 'Hello! I can help you find a property in our listings (tell me the area, type, budget and bedrooms), answer questions about a listing, or book a viewing for you.',
    ar: 'أهلاً بك! أقدر أساعدك تلاقي عقار من وحداتنا (قولّي المنطقة والنوع والميزانية وعدد الغرف)، أو أجاوب عن أي وحدة، أو أحجز لك معاينة.',
  });
}

export function refusalReply(language: Language): string {
  return pick(language, {
    en: 'Sorry, I can only help with real estate: finding properties in our listings, answering questions about them and booking viewings. What kind of property are you looking for?',
    ar: 'عذراً، أقدر أساعدك في العقارات فقط: البحث في وحداتنا، والإجابة عن أسئلتك عنها، وحجز المعاينات. إيه نوع العقار اللي بتدور عليه؟',
  });
}

export function emptyAnswerReply(language: Language): string {
  return pick(language, {
    en: 'Sorry, I could not put an answer together. Please try rephrasing your request.',
    ar: 'عذراً، مقدرتش أجهز إجابة. ممكن تعيد صياغة طلبك؟',
  });
}

export function unknownListingReply(language: Language): string {
  return pick(language, {
    en: 'Which listing do you mean? Search first, then refer to a result by its position ("the second one") or its title.',
    ar: 'تقصد أنهي وحدة؟ ابدأ بالبحث، وبعدها اذكر الوحدة بترتيبها ("التانية") أو بعنوانها.',
  });
}

export function listingUnavailableReply(language: Language): string {
  return pick(language, {
    en: 'That listing is no longer available. Would you like me to search again?',
    ar: 'الوحدة دي مبقتش متاحة. تحب أبحث لك من جديد؟',
  });
}

export function bookingCancelledReply(language: Language): string {
  return pick(language, {
    en: 'That slot was cancelled by our team — please choose another date.',
    ar: 'الموعد ده اتلغى من فريقنا — من فضلك اختار تاريخ تاني.',
  });
}

export type BookingField = 'property' | 'name' | 'phone' | 'preferredDate';

export type BookingProblem =
  | 'invalid_phone'
  | 'invalid_name'
  | 'invalid_date'
  | 'date_not_future'
  | 'date_too_far';

const FIELD_LABEL: Record<BookingField, Localised> = {
  property: {
    en: 'which listing you would like to view',
    ar: 'الوحدة اللي عايز تعاينها',
  },
  name: { en: 'your full name', ar: 'اسمك بالكامل' },
  phone: {
    en: 'your mobile number (e.g. 01001234567)',
    ar: 'رقم موبايلك (مثال: 01001234567)',
  },
  preferredDate: {
    en: `your preferred viewing date (within the next ${MAX_BOOKING_DAYS_AHEAD} days)`,
    ar: `التاريخ المناسب للمعاينة (خلال ${MAX_BOOKING_DAYS_AHEAD} يوم من النهارده)`,
  },
};

const PROBLEM_TEXT: Record<BookingProblem, Localised> = {
  invalid_phone: {
    en: 'That does not look like an Egyptian mobile number (for example 01001234567 or +201001234567).',
    ar: 'الرقم ده مش شكل رقم موبايل مصري (مثال: 01001234567 أو +201001234567).',
  },
  invalid_name: {
    en: 'Please give your name as a few letters, up to 80 characters.',
    ar: 'اكتب اسمك من حرفين على الأقل وبحد أقصى 80 حرف.',
  },
  invalid_date: {
    en: 'I could not read that date.',
    ar: 'مقدرتش أفهم التاريخ ده.',
  },
  date_not_future: {
    en: 'The viewing date has to be after today.',
    ar: 'تاريخ المعاينة لازم يكون بعد النهارده.',
  },
  date_too_far: {
    en: `Viewings can be booked up to ${MAX_BOOKING_DAYS_AHEAD} days ahead.`,
    ar: `الحجز متاح حتى ${MAX_BOOKING_DAYS_AHEAD} يوم قدّام.`,
  },
};

function joinList(items: string[], language: Language): string {
  const [last, ...rest] = [...items].reverse();
  if (last === undefined) return '';
  if (rest.length === 0) return last;
  const separator = language === 'ar' ? '، ' : ', ';
  const and = language === 'ar' ? ' و' : ' and ';
  return `${rest.reverse().join(separator)}${and}${last}`;
}

export function bookingQuestion(
  language: Language,
  title: string | undefined,
  missing: BookingField[],
  problems: BookingProblem[],
): string {
  const parts: string[] = problems.map((problem) =>
    pick(language, PROBLEM_TEXT[problem]),
  );
  const needed = joinList(
    missing.map((field) => pick(language, FIELD_LABEL[field])),
    language,
  );
  if (title) {
    parts.push(
      pick(language, {
        en: `To book a viewing of "${title}", I still need ${needed}.`,
        ar: `عشان أحجز لك معاينة لـ "${title}"، لسه محتاج ${needed}.`,
      }),
    );
  } else {
    parts.push(
      pick(language, {
        en: `To book a viewing I still need ${needed}.`,
        ar: `عشان أحجز لك معاينة لسه محتاج ${needed}.`,
      }),
    );
  }
  return parts.join(' ');
}

export function bookingConfirmation(
  language: Language,
  booking: BookingSummary,
  created: boolean,
): string {
  return pick(language, {
    en: `${created ? 'Your viewing is confirmed' : 'This viewing was already booked and is confirmed'}: "${booking.propertyTitle}" on ${booking.preferredDate} for ${booking.name}. Booking reference: ${booking.reference}. We will call you on ${booking.phone} if anything changes.`,
    ar: `${created ? 'تم تأكيد معاينتك' : 'المعاينة دي كانت محجوزة بالفعل ومؤكدة'}: "${booking.propertyTitle}" يوم ${booking.preferredDate} باسم ${booking.name}. رقم الحجز: ${booking.reference}. هنتصل بك على ${booking.phone} لو حصل أي تغيير.`,
  });
}
