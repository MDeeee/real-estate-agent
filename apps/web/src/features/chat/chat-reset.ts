/**
 * "New chat" rotates the server-side conversation cookie. The visitor's next
 * message must not be posted before that finishes (it would land in the old
 * conversation), but the composer must not make them wait either: a send made
 * during a reset is queued behind it with `whenReady`.
 */
export class ResetGate {
  private pending: Promise<boolean> | null = null;

  /** A reset is running. */
  get active(): boolean {
    return this.pending !== null;
  }

  /** Runs a reset; resolves `true` when it succeeded, `false` when it failed. */
  begin(request: () => Promise<boolean>): Promise<boolean> {
    const run: Promise<boolean> = request()
      .catch(() => false)
      .finally(() => {
        if (this.pending === run) this.pending = null;
      });
    this.pending = run;
    return run;
  }

  /** Resolves `true` at once when no reset is running, otherwise with its outcome. */
  whenReady(): Promise<boolean> {
    return this.pending ?? Promise.resolve(true);
  }
}
