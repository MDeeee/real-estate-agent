export const metadata = { title: "Admin | Real-estate AI agent" };

export default function AdminPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
      <p className="mt-2 text-muted">
        Document upload, indexing status and bookings will be managed here.
      </p>
    </main>
  );
}
