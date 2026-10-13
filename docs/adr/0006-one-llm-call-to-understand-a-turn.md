# 0006. One LLM call to understand a turn

Date: 2026-10-13
Status: Accepted (amends [ADR 0003](0003-langgraph-for-agent-flow.md))

## Context

A search turn made three sequential LLM calls: `route` (intent, search mode, preferences), `extract_filters` (the filters) and `answer`. On a slow provider (a free tier answering in 10 to 60 seconds, sometimes 503 "high demand") that is the whole latency budget: turns hit `CHAT_TURN_TIMEOUT_MS` and the visitor only saw "The operation was aborted due to timeout" after a long wait. Two of the three calls read the same conversation.

## Decision

- Merge `route` and `extract_filters` into one structured-output call and one graph node, `understand`. The call returns the intent, the property reference, and, for a search, the search mode (`new` or `refine`), the qualitative preferences and the filters. The graph is now `understand` then `retrieve` then `answer` (or `details`, `book`, `smalltalk`, `refuse`), then `trim`. A search turn makes two LLM calls instead of three; details and booking turns are unchanged (one understanding call plus the answer or the booking extraction).
- Everything the two nodes guaranteed stays in code, not in the prompt: the filters are validated against the same `propertyFiltersSchema` as the regular search with one retry (the reasons are fed back to the model), a different `listing` or `type` than the previous search forces a new search whatever the model said, a city change alone stays a refinement, refinements start from the previous filters, and off-topic requests get the static refusal. When the safety net fires, `understand` is called once more as a new search; this rare path is the only case where a search turn makes three calls.
- Ordinals ("the second one", "التاني", "the last one", "number 3") are resolved deterministically from the visitor's latest message against the list shown in the previous assistant turn. The model's property reference is only the fallback. The reply language was already decided in code.
- Fail fast: `LLM_MAX_RETRIES` (default 1) replaces LangChain's silent retries (6 by default) and `LLM_CALL_TIMEOUT_MS` (default 30 s) bounds each call. A 429, 503 or "overloaded" answer, or a call timeout, ends the turn at once with the `provider_busy` error event and the usual rollback, instead of waiting for the turn timeout.

## Consequences

- Latency and cost drop: one call fewer per search turn, and one less prompt that re-sends the conversation.
- Trade-off: one bigger prompt carries both the routing rules and the filter rules, and the model must also decide `new` or `refine` in the same pass. The `new` search used to be extracted from the latest message alone (nothing from earlier turns could leak); now the model sees the recent conversation and is told to use only the latest request, and the deterministic identity check plus the forced-new retry catch the leak that matters most (sale vs rent, property type). Evals may score filter extraction slightly differently; re-record the baseline.
- A validation failure retries the whole combined call, not only the filters.
- The `AgentModel` port has one method, `understand`, instead of `classify` and `extractFilters`.
