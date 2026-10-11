export function AskAiPanel() {
  return (
    <section
      aria-labelledby="ask-ai-heading"
      className="rounded-xl border border-border bg-surface p-5 lg:sticky lg:top-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="ask-ai-heading" className="text-lg font-semibold">
          Ask the AI
        </h2>
        <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-medium text-warning">
          Coming soon
        </span>
      </div>
      <p className="mt-2 text-sm text-muted">
        Soon you will be able to describe what you want in Arabic or English,
        get answers grounded in these listings and book a viewing in the same
        conversation.
      </p>
      <div className="mt-4">
        <label htmlFor="ask-ai-input" className="block text-sm font-medium">
          Your question
        </label>
        <textarea
          id="ask-ai-input"
          rows={3}
          disabled
          placeholder="Not available yet"
          className="mt-1 block w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          disabled
          className="mt-3 w-full cursor-not-allowed rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground opacity-50"
        >
          Send
        </button>
      </div>
    </section>
  );
}
