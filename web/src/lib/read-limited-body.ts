export class BodyTooLargeError extends Error {
  readonly limit: number;

  constructor(limit: number) {
    super(`The request body is larger than ${limit} bytes.`);
    this.name = "BodyTooLargeError";
    this.limit = limit;
  }
}

/**
 * Reads a request body as text without ever holding more than `limit` bytes.
 *
 * A declared `Content-Length` over the limit is refused before reading a byte.
 * That header can lie (or be absent for chunked bodies), so the stream is also
 * counted as it arrives and cancelled the moment it passes the limit.
 */
export async function readLimitedBody(
  request: Request,
  limit: number,
): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await request.body?.cancel().catch(() => undefined);
    throw new BodyTooLargeError(limit);
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError(limit);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
