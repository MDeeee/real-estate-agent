import type { BookingItem, Page } from "@/lib/admin-schemas";
import { formatBookingWhen } from "@/lib/booking-when";
import { formatDateTime } from "@/lib/format";
import { Pagination } from "./pagination";

const statusClass = {
  CONFIRMED: "bg-success-soft text-success",
  CANCELLED: "bg-border/60 text-muted",
} as const;

export function BookingsTable({ data }: { data: Page<BookingItem> }) {
  if (data.total === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted">
        No bookings yet. Viewings booked through the chat will appear here.
      </p>
    );
  }

  return (
    <>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <caption className="sr-only">Property viewing bookings</caption>
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Visitor</th>
              <th scope="col" className="px-4 py-3 font-medium">Phone</th>
              <th scope="col" className="px-4 py-3 font-medium">Property</th>
              <th scope="col" className="px-4 py-3 font-medium">Preferred viewing</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium">Booked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.items.map((booking) => (
              <tr key={booking.id} className="align-top">
                <td dir="auto" className="px-4 py-3 font-medium">
                  {booking.name}
                </td>
                <td dir="ltr" className="whitespace-nowrap px-4 py-3 text-left">
                  {booking.phone}
                </td>
                <td className="max-w-xs px-4 py-3">
                  <p dir="auto" className="break-words">
                    {booking.property.title}
                  </p>
                  <p className="text-xs text-muted">{booking.property.slug}</p>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {formatBookingWhen(booking.preferredDate, booking.preferredTime)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClass[booking.status]}`}
                  >
                    {booking.status}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted">
                  {formatDateTime(booking.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        tab="bookings"
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
      />
    </>
  );
}
