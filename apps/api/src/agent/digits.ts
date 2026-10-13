const ARABIC_INDIC_ZERO = 0x0660;
const EASTERN_ARABIC_INDIC_ZERO = 0x06f0;

/** Converts Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits to 0-9. */
export function toLatinDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(
      code >= EASTERN_ARABIC_INDIC_ZERO
        ? code - EASTERN_ARABIC_INDIC_ZERO
        : code - ARABIC_INDIC_ZERO,
    );
  });
}
