/** Short, display-ready wording for a listing's delivery, finishing and payment plan. */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** The year and day of a delivery date: an ISO string (chat cards) or a Date, read in UTC. */
function utcParts(value: Date | string): { year: number; time: number } | null {
  const iso = typeof value === "string" ? ISO_DAY.exec(value) : null;
  const date = iso
    ? new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`)
    : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : { year: date.getUTCFullYear(), time };
}

/**
 * "Ready" for a delivery date that has passed, otherwise "Delivery 2027".
 * `null` (no date, or one that cannot be read) means nothing to show.
 */
export function formatDelivery(
  value: Date | string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (value === null || value === undefined) return null;
  const parts = utcParts(value);
  if (!parts) return null;
  return parts.time <= now.getTime() ? "Ready" : `Delivery ${parts.year}`;
}

/** "fully finished" becomes "Fully finished"; blank means nothing to show. */
export function formatFinishing(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const DOWN_PAYMENT = /(\d+(?:\.\d+)?)\s*%\s*down/i;
const YEARS = /(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/gi;
/** Words that tie a number of years to the instalments rather than to the delivery. */
const INSTALMENT_WORD = /instal?lments?|installments?|\bover\b|قسط|تقسيط/i;

/**
 * The years of the instalments: only a clause that says instalment/over (or
 * قسط/تقسيط) counts, so "Delivery in 2 years, 10% down, 8 years instalments"
 * gives 8 and not the delivery horizon. `undefined` when no clause says it or
 * the clauses disagree.
 */
function instalmentYears(text: string): string | undefined {
  const years = new Set<string>();
  for (const clause of text.split(/[,;.\n]|\band\b/i)) {
    if (!INSTALMENT_WORD.test(clause)) continue;
    for (const match of clause.matchAll(YEARS)) {
      if (match[1]) years.add(match[1]);
    }
  }
  return years.size === 1 ? [...years][0] : undefined;
}

/**
 * A short payment plan line. The plan is free text written by the agency, so
 * only the common English shape ("10% down payment, 8 years instalments") is
 * compacted, to "10% down · 8 yrs". Anything else (Arabic, rent terms, or a
 * plan whose years are not clearly the instalments) is shown as written; the
 * caller clamps its length.
 */
export function formatPaymentPlan(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const down = DOWN_PAYMENT.exec(text)?.[1];
  const years = instalmentYears(text);
  return down && years ? `${down}% down · ${years} yrs` : text;
}
