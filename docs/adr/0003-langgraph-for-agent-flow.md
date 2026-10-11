# 0003. LangGraph for the agent flow

Date: 2026-10-12
Status: Accepted

## Context

The assistant must route between distinct behaviours (search, property details, booking, refusal), keep per-conversation state such as a partially filled booking, stream tokens and structured results to the browser, and produce grounded answers whose citations can be checked. A single prompt with tools would hide these steps, make the booking slot-filling hard to test, and give no natural place for guardrails.

## Decision

Model the agent as a LangGraph.js `StateGraph` with explicit nodes (`route`, `extract_filters`, `retrieve`, `answer`, `book`, `refuse`) and typed state (`messages`, `intent`, `filters`, `candidates`, `bookingDraft`). Every LLM call that feeds control flow uses zod-validated structured output. Conversation state is persisted with the Postgres checkpointer, keyed by a thread id per browser. A maximum step count bounds each run.

## Consequences

- Each node is a small, separately testable function; routing and the grounding post-check are plain code, not prompt behaviour.
- Booking state survives across turns and process restarts through the checkpointer.
- Streaming maps directly onto graph stream events and an SSE endpoint.
- Adds a framework dependency and a checkpoint schema to manage; accepted because the flow is genuinely stateful and branching.
