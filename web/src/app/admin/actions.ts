"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import {
  ADMIN_COOKIE,
  ADMIN_HOME,
  AdminApiError,
  LOGIN_PATH,
  deleteDocument as deleteDocumentRequest,
  reindexDocument as reindexDocumentRequest,
  uploadFiles,
  verifyToken,
} from "@/lib/admin-api";
import { type IngestResult, UPLOAD_BATCH_SIZE } from "@/lib/admin-schemas";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

export type LoginState = { error?: string };

export type UploadBatchState =
  | { status: "error"; message: string }
  | { status: "done"; results: IngestResult[] };

export type ActionResult = { ok: true } | { ok: false; message: string };

const loginSchema = z.object({
  token: z.string().trim().min(1, "Enter the admin token.").max(512),
});

const idSchema = z.string().min(1).max(64);

function describe(error: unknown): string {
  if (error instanceof AdminApiError) return error.message;
  return "Something went wrong. Please try again.";
}

export async function login(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ token: formData.get("token") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const check = await verifyToken(parsed.data.token);
  if (check === "unreachable") {
    return {
      error: "The API is unreachable. Check that it is running and try again.",
    };
  }
  if (check === "invalid") return { error: "That token is not valid." };

  (await cookies()).set(ADMIN_COOKIE, parsed.data.token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect(ADMIN_HOME);
}

export async function logout(): Promise<void> {
  (await cookies()).delete({ name: ADMIN_COOKIE, path: "/admin" });
  redirect(LOGIN_PATH);
}

/**
 * Uploads one batch of files. The client calls this once per batch (server
 * actions cannot stream progress) and aggregates the results; the admin token
 * stays in the httpOnly cookie on the server. The client already dropped files
 * that cannot be valid, so nothing is filtered out here: whatever arrives is
 * sent and reported.
 */
export async function uploadDocumentBatch(
  formData: FormData,
): Promise<UploadBatchState> {
  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return { status: "error", message: "Choose at least one .md file." };
  }
  if (files.length > UPLOAD_BATCH_SIZE) {
    return {
      status: "error",
      message: `Upload at most ${UPLOAD_BATCH_SIZE} files per batch.`,
    };
  }

  try {
    const results = await uploadFiles(files);
    revalidatePath(ADMIN_HOME);
    return { status: "done", results };
  } catch (error) {
    unstable_rethrow(error);
    return { status: "error", message: describe(error) };
  }
}

export async function reindexDocument(id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: "Invalid document id." };

  try {
    const result = await reindexDocumentRequest(parsed.data);
    revalidatePath(ADMIN_HOME);
    return result.outcome === "failed"
      ? { ok: false, message: result.error ?? "Re-indexing failed." }
      : { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: describe(error) };
  }
}

export async function deleteDocument(id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: "Invalid document id." };

  try {
    await deleteDocumentRequest(parsed.data);
    revalidatePath(ADMIN_HOME);
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: describe(error) };
  }
}
