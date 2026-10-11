import type { DocumentItem, Page } from "@/lib/admin-schemas";
import { formatDateTime } from "@/lib/format";
import { DocumentActions } from "./document-actions";
import { Pagination } from "./pagination";
import { StatusBadge } from "./status-badge";

export function DocumentsTable({ data }: { data: Page<DocumentItem> }) {
  if (data.total === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted">
        No documents yet. Upload a property <code>.md</code> file to get started.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <caption className="sr-only">Uploaded documents</caption>
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium">File</th>
              <th scope="col" className="px-4 py-3 font-medium">Property</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Chunks</th>
              <th scope="col" className="px-4 py-3 font-medium">Updated</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.items.map((document) => (
              <tr key={document.id} className="align-top">
                <td className="px-4 py-3">
                  <StatusBadge status={document.status} />
                </td>
                <td className="max-w-xs px-4 py-3">
                  <p dir="auto" className="break-words font-medium">
                    {document.filename}
                  </p>
                  {document.error ? (
                    <details className="mt-1 group">
                      <summary className="cursor-pointer text-xs text-danger">
                        Show error
                      </summary>
                      <pre
                        dir="auto"
                        className="mt-2 whitespace-pre-wrap break-words rounded-md bg-danger-soft p-3 font-mono text-xs text-danger"
                      >
                        {document.error}
                      </pre>
                    </details>
                  ) : null}
                </td>
                <td className="max-w-xs px-4 py-3">
                  {document.property ? (
                    <>
                      <p dir="auto" className="break-words">
                        {document.property.title}
                      </p>
                      <p className="text-xs text-muted">
                        {document.property.slug}
                      </p>
                    </>
                  ) : (
                    <span className="text-muted">&mdash;</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {document.chunkCount}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted">
                  {formatDateTime(document.updatedAt)}
                </td>
                <td className="px-4 py-3">
                  <DocumentActions
                    id={document.id}
                    filename={document.filename}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        tab="documents"
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
      />
    </>
  );
}
