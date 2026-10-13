import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/http";
import type { IngestResult } from "./schemas";
import { runUpload, type UploadFlowDeps } from "./upload-flow";

function file(name: string): File {
  return new File(["# listing"], name, { type: "text/markdown" });
}

function files(count: number): File[] {
  return Array.from({ length: count }, (_, index) => file(`f${index}.md`));
}

const created = (filename: string): IngestResult => ({
  filename,
  outcome: "created",
  chunks: 2,
});

/** The hash of the stored version that `conflictFor` reports for a slug. */
const hashFor = (slug: string) => `hash-of-${slug}`;

const conflictFor = (filename: string, slug: string): IngestResult => ({
  filename,
  outcome: "conflict",
  propertySlug: slug,
  conflict: {
    slug,
    existingTitle: "Old title",
    existingFilename: "old.md",
    existingContentHash: hashFor(slug),
    existingUpdatedAt: new Date("2026-10-01T10:00:00Z"),
    newTitle: "New title",
  },
});

function deps(extra: Pick<UploadFlowDeps, "onProgress"> = {}) {
  const send = vi.fn<UploadFlowDeps["send"]>(async (batch) =>
    batch.map((item) => created(item.name)),
  );
  const decide = vi.fn<UploadFlowDeps["decide"]>(async (conflicts) =>
    conflicts.map(() => false),
  );
  return { send, decide, ...extra };
}

describe("runUpload", () => {
  it("sends 5 files per request and never asks when nothing conflicts", async () => {
    const flow = deps();

    const { rows, abortMessage } = await runUpload(files(12), flow);

    expect(flow.send.mock.calls.map(([batch]) => batch.length)).toEqual([5, 5, 2]);
    expect(flow.send.mock.calls.every(([, replacements]) => replacements.length === 0)).toBe(true);
    expect(flow.decide).not.toHaveBeenCalled();
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.outcome === "created")).toBe(true);
    expect(abortMessage).toBeNull();
  });

  it("reports progress per batch and clears it at the end", async () => {
    const progress: unknown[] = [];
    await runUpload(files(7), deps({ onProgress: (value) => progress.push(value) }));

    expect(progress).toEqual([
      { from: 1, to: 5, total: 7 },
      { from: 6, to: 7, total: 7 },
      null,
    ]);
  });

  it("asks once for all conflicts, then re-sends only the approved files with the stored version they saw", async () => {
    const batch = files(3);
    const send = vi
      .fn<UploadFlowDeps["send"]>()
      .mockResolvedValueOnce([
        created("f0.md"),
        conflictFor("f1.md", "slug-one"),
        conflictFor("f2.md", "slug-two"),
      ])
      .mockResolvedValueOnce([{ filename: "f1.md", outcome: "updated", chunks: 3 }]);
    const decide = vi.fn<UploadFlowDeps["decide"]>(async () => [true, false]);

    const { rows } = await runUpload(batch, { send, decide });

    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0]?.[0].map(({ file: item, conflict }) => [item.name, conflict.slug])).toEqual([
      ["f1.md", "slug-one"],
      ["f2.md", "slug-two"],
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0].map((item) => item.name)).toEqual(["f1.md"]);
    expect(send.mock.calls[1]?.[1]).toEqual([
      { slug: "slug-one", existingContentHash: hashFor("slug-one") },
    ]);
    expect(rows.map((row) => [row.filename, row.outcome])).toEqual([
      ["f0.md", "created"],
      ["f1.md", "updated"],
      ["f2.md", "skipped"],
    ]);
    expect(rows[2]?.note).toContain("Old title");
  });

  it("sends nothing more when every conflict is skipped", async () => {
    const send = vi
      .fn<UploadFlowDeps["send"]>()
      .mockResolvedValueOnce([conflictFor("f0.md", "slug-one")]);

    const { rows } = await runUpload(files(1), {
      send,
      decide: async (conflicts) => conflicts.map(() => false),
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(rows.map((row) => row.outcome)).toEqual(["skipped"]);
  });

  it("re-sends approved files in batches of 5, each with its own approval", async () => {
    const many = files(7);
    const send = vi.fn<UploadFlowDeps["send"]>(async (batch, replacements) =>
      replacements.length === 0
        ? batch.map((item, index) => conflictFor(item.name, `slug-${item.name}-${index}`))
        : batch.map((item) => ({ filename: item.name, outcome: "updated" as const })),
    );

    const { rows } = await runUpload(many, {
      send,
      decide: async (conflicts) => conflicts.map(() => true),
    });

    const resends = send.mock.calls.filter(([, replacements]) => replacements.length > 0);
    expect(resends.map(([batch]) => batch.length)).toEqual([5, 2]);
    expect(resends.map(([, replacements]) => replacements.length)).toEqual([5, 2]);
    expect(resends[0]?.[1][0]).toEqual({
      slug: "slug-f0.md-0",
      existingContentHash: hashFor("slug-f0.md-0"),
    });
    expect(rows.every((row) => row.outcome === "updated")).toBe(true);
  });

  it("stops at a failed request, reports the rest as not uploaded and does not ask", async () => {
    const send = vi
      .fn<UploadFlowDeps["send"]>()
      .mockResolvedValueOnce([
        conflictFor("f0.md", "slug-one"),
        created("f1.md"),
        created("f2.md"),
        created("f3.md"),
        created("f4.md"),
      ])
      .mockRejectedValueOnce(new ApiError(503, "The API is unreachable."));
    const decide = vi.fn<UploadFlowDeps["decide"]>();

    const { rows, abortMessage } = await runUpload(files(8), { send, decide });

    expect(decide).not.toHaveBeenCalled();
    expect(abortMessage).toBe("The API is unreachable.");
    expect(rows.map((row) => row.outcome)).toEqual([
      "failed",
      "created",
      "created",
      "created",
      "created",
      "failed",
      "failed",
      "failed",
    ]);
    expect(rows[5]?.error).toBe("Not uploaded: The API is unreachable.");
  });

  it("does not claim the admin kept a listing they were never asked about", async () => {
    const send = vi
      .fn<UploadFlowDeps["send"]>()
      .mockResolvedValueOnce([
        conflictFor("f0.md", "slug-one"),
        created("f1.md"),
        created("f2.md"),
        created("f3.md"),
        created("f4.md"),
      ])
      .mockRejectedValueOnce(new ApiError(503, "The API is unreachable."));

    const { rows } = await runUpload(files(6), { send, decide: vi.fn() });

    expect(rows[0]).toMatchObject({ filename: "f0.md", outcome: "failed" });
    expect(rows[0]?.error).toBe(
      'Not uploaded: the upload was interrupted before you could confirm replacing "Old title" (slug-one). Upload this file again.',
    );
    expect(rows[0]?.note).toBeUndefined();
    expect(rows.some((row) => row.outcome === "skipped")).toBe(false);
  });

  it("reports an approval that went stale as a listing that changed while uploading", async () => {
    const send = vi
      .fn<UploadFlowDeps["send"]>()
      .mockResolvedValueOnce([conflictFor("f0.md", "slug-one")])
      // The API refuses the approval: the stored version is a different one now.
      .mockResolvedValueOnce([conflictFor("f0.md", "slug-one")]);

    const { rows } = await runUpload(files(1), {
      send,
      decide: async (conflicts) => conflicts.map(() => true),
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(rows).toEqual([
      {
        filename: "f0.md",
        outcome: "failed",
        error: "The listing changed while uploading. Upload this file again.",
      },
    ]);
  });
});
