import type { ChatBooking } from "@/lib/chat-schemas";

export function BookingCard({ booking }: { booking: ChatBooking }) {
  return (
    <section
      aria-label="Booking confirmation"
      className="rounded-lg border border-success/40 bg-success-soft p-3 text-sm"
    >
      <p className="font-semibold text-success">Viewing confirmed</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted">Reference</dt>
        <dd className="font-mono font-medium">{booking.reference}</dd>
        <dt className="text-muted">Property</dt>
        <dd dir="auto">{booking.propertyTitle}</dd>
        <dt className="text-muted">Date</dt>
        <dd>{booking.preferredDate}</dd>
        <dt className="text-muted">Name</dt>
        <dd dir="auto">{booking.name}</dd>
        <dt className="text-muted">Phone</dt>
        <dd dir="ltr">{booking.phone}</dd>
      </dl>
    </section>
  );
}
