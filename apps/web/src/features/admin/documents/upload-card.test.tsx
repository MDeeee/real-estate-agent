import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadCard } from "./upload-card";

const LISTING = "---\nslug: x\n---\n\nbody";

interface Call {
  filenames: string[];
  replacements: { slug: string; existingContentHash: string }[];
}

const STORED_HASH = "a".repeat(64);

/** A fake API: the first upload of `clash.md` conflicts; sending its slug confirmed replaces it. */
function stubApi() {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      const files = form.getAll("files") as File[];
      const replacements = (form.getAll("replacements") as string[]).map(
        (value) => JSON.parse(value) as Call["replacements"][number],
      );
      calls.push({ filenames: files.map((file) => file.name), replacements });
      return Response.json(
        files.map((file) => {
          if (file.name !== "clash.md") {
            return { filename: file.name, outcome: "created", chunks: 2 };
          }
          return replacements.some(
            (item) =>
              item.slug === "taken-slug" && item.existingContentHash === STORED_HASH,
          )
            ? { filename: file.name, outcome: "updated", chunks: 3 }
            : {
                filename: file.name,
                outcome: "conflict",
                propertySlug: "taken-slug",
                conflict: {
                  slug: "taken-slug",
                  existingTitle: "Sunny flat",
                  existingFilename: "sunny.md",
                  existingContentHash: STORED_HASH,
                  existingUpdatedAt: "2026-10-01T10:00:00.000Z",
                  newTitle: "Garden villa",
                },
              };
        }),
      );
    }),
  );
  return calls;
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <UploadCard />
    </QueryClientProvider>,
  );
}

async function chooseAndUpload(names: string[]) {
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText(/drop \.md files here/i),
    names.map((name) => new File([LISTING], name, { type: "text/markdown" })),
  );
  await user.click(screen.getByRole("button", { name: /^upload \d+ files?$/i }));
  return user;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UploadCard conflict dialog", () => {
  it("shows an accessible dialog for a conflict and replaces only after the admin says so", async () => {
    const calls = stubApi();
    renderCard();

    const user = await chooseAndUpload(["new.md", "clash.md"]);

    const dialog = await screen.findByRole("dialog", {
      name: /replace existing listing/i,
    });
    expect(dialog).toHaveAccessibleDescription(/nothing has been changed yet/i);
    expect(dialog).toHaveTextContent(
      /taken-slug already exists \(“Sunny flat”, from file sunny\.md, updated .*\)\. Replace with “Garden villa” from clash\.md\?/,
    );
    // Every file starts on Skip: replacing is a deliberate choice, and focus is on the heading.
    expect(within(dialog).getByRole("radio", { name: "Skip" })).toBeChecked();
    expect(dialog.querySelector("h2")).toHaveFocus();
    expect(calls).toEqual([
      { filenames: ["new.md", "clash.md"], replacements: [] },
    ]);

    await user.click(within(dialog).getByRole("radio", { name: "Replace" }));
    await user.click(
      within(dialog).getByRole("button", { name: /replace 1, skip 0/i }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls[1]).toEqual({
      filenames: ["clash.md"],
      replacements: [{ slug: "taken-slug", existingContentHash: STORED_HASH }],
    });
    const report = await screen.findByText(/finished:/i);
    expect(report).toHaveTextContent("1 created, 1 updated");
    expect(report).toHaveFocus();
  });

  it("keeps the existing listing when the admin skips, and reports it as skipped", async () => {
    const calls = stubApi();
    renderCard();

    const user = await chooseAndUpload(["clash.md"]);
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /continue without replacing/i }),
    );

    expect(await screen.findByText(/finished: 1 skipped/i)).toBeInTheDocument();
    expect(screen.getByText(/kept the existing listing “?"?sunny flat/i)).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  it("treats Escape as Skip all", async () => {
    const calls = stubApi();
    renderCard();

    const user = await chooseAndUpload(["clash.md"]);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    // jsdom does not turn Escape into a dialog `cancel` event; the browser does.
    screen.getByRole("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));

    expect(await screen.findByText(/finished: 1 skipped/i)).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  it("offers Replace all and Skip all when several files conflict", async () => {
    stubApi();
    renderCard();

    const user = await chooseAndUpload(["clash.md", "clash.md"]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName(/replace existing listings \(2\)/i);

    await user.click(within(dialog).getByRole("button", { name: /replace all/i }));
    expect(within(dialog).getAllByRole("radio", { name: "Replace" }).every((radio) => (radio as HTMLInputElement).checked)).toBe(true);
    expect(
      within(dialog).getByRole("button", { name: /replace 2, skip 0/i }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /skip all/i }));
    expect(
      within(dialog).getByRole("button", { name: /continue without replacing/i }),
    ).toBeInTheDocument();
  });
});
