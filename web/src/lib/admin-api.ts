import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  API_UNREACHABLE_MESSAGE,
  apiBaseUrl,
  readErrorMessage,
} from "./api-base";
import {
  bookingItemSchema,
  documentItemSchema,
  ingestResultSchema,
  pageSchema,
  type BookingItem,
  type DocumentItem,
  type IngestResult,
  type Page,
} from "./admin-schemas";

export const ADMIN_COOKIE = "admin_token";
export const ADMIN_HOME = "/admin";
export const LOGIN_PATH = "/admin/login";

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

async function request(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-admin-token", token);
  try {
    return await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch {
    throw new AdminApiError(503, API_UNREACHABLE_MESSAGE);
  }
}

async function authorisedRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) redirect(LOGIN_PATH);

  const response = await request(path, token, init);
  if (response.status === 401) redirect(`${LOGIN_PATH}?reason=expired`);
  return response;
}

async function failure(response: Response): Promise<AdminApiError> {
  return new AdminApiError(response.status, await readErrorMessage(response));
}

async function readJson<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  if (!response.ok) throw await failure(response);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new AdminApiError(502, "The API returned an unexpected response.");
  }
  return parsed.data;
}

export type TokenCheck = "valid" | "invalid" | "unreachable";

export async function verifyToken(token: string): Promise<TokenCheck> {
  try {
    const response = await request("/admin/session", token);
    if (response.status === 204) return "valid";
    return response.status === 401 ? "invalid" : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function fetchDocuments(
  page: number,
  pageSize: number,
): Promise<Page<DocumentItem>> {
  const response = await authorisedRequest(
    `/admin/documents?page=${page}&pageSize=${pageSize}`,
  );
  return readJson(response, pageSchema(documentItemSchema));
}

export async function fetchBookings(
  page: number,
  pageSize: number,
): Promise<Page<BookingItem>> {
  const response = await authorisedRequest(
    `/admin/bookings?page=${page}&pageSize=${pageSize}`,
  );
  return readJson(response, pageSchema(bookingItemSchema));
}

export async function uploadFiles(files: File[]): Promise<IngestResult[]> {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  const response = await authorisedRequest("/admin/documents", {
    method: "POST",
    body: form,
  });
  return readJson(response, z.array(ingestResultSchema));
}

export async function reindexDocument(id: string): Promise<IngestResult> {
  const response = await authorisedRequest(
    `/admin/documents/${encodeURIComponent(id)}/reindex`,
    { method: "POST" },
  );
  return readJson(response, ingestResultSchema);
}

export async function deleteDocument(id: string): Promise<void> {
  const response = await authorisedRequest(
    `/admin/documents/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw await failure(response);
}
