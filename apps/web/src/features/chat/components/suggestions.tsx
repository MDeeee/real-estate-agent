const SUGGESTIONS = [
  { text: "3 bedroom apartment in New Cairo under 7 million", lang: "en" },
  { text: "Show me villas for rent with a garden", lang: "en" },
  { text: "عايز شقة إيجار في الشيخ زايد", lang: "ar" },
  { text: "شقة للبيع قريبة من المدارس وهادية", lang: "ar" },
] as const;

export function Suggestions({
  onPick,
  disabled,
}: {
  onPick: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="py-2">
      <p className="text-sm text-muted">
        Describe what you are looking for in Arabic or English. I search our
        listings, answer questions about them and can book a viewing.
      </p>
      <ul className="mt-4 flex flex-wrap gap-2" aria-label="Example questions">
        {SUGGESTIONS.map(({ text, lang }) => (
          <li key={text}>
            <button
              type="button"
              lang={lang}
              dir="auto"
              disabled={disabled}
              onClick={() => onPick(text)}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-start text-sm transition-colors hover:bg-border/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
