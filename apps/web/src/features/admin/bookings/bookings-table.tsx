import { useState } from "react";
import { describeError } from "@/shared/api/http";
import type { Page } from "@/shared/api/page";
import { formatBookingWhen } from "@/shared/lib/booking-when";
import { formatDateTime } from "@/shared/lib/format";
import { useMediaQuery } from "@/shared/lib/use-media-query";
import { Button } from "@/shared/ui/button";
import { Pagination } from "../components/pagination";
import { useCancelBooking } from "./bookings-api";
import { CancelBookingDialog } from "./cancel-booking-dialog";
import type { BookingItem } from "./schemas";

const statusClass = {
  CONFIRMED: "bg-success-soft text-success",
  CANCELLED: "bg-border/60 text-muted",
} as const;

/** Tailwind's `sm` breakpoint: from here the bookings are a table, below it stacked cards. */
const TABLE_QUERY = "(min-width: 40rem)";

/** The Cancel button of an active booking, and (always mounted, so it is announced) why the last cancel failed. */
function CancelAction({
  booking,
  error,
  onCancel,
  align,
}: {
  booking: BookingItem;
  error: string | undefined;
  onCancel: (booking: BookingItem) => void;
  align: "start" | "end";
}) {
  const side = align === "end" ? "ml-auto text-right" : "";
  return (
    <>
      {booking.status === "CONFIRMED" ? (
        <Button
          className="whitespace-nowrap"
          aria-label={`Cancel booking ${booking.reference}`}
          onClick={() => onCancel(booking)}
        >
          Cancel
        </Button>
      ) : null}
      <p
        role="alert"
        className={`${side} mt-2 max-w-xs text-xs text-danger empty:hidden`}
      >
        {error}
      </p>
    </>
  );
}

function StatusBadge({ status }: { status: BookingItem["status"] }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClass[status]}`}
    >
      {status}
    </span>
  );
}

interface RowProps {
  booking: BookingItem;
  error: string | undefined;
  onCancel: (booking: BookingItem) => void;
}

function BookingRow({ booking, error, onCancel }: RowProps) {
  return (
    <tr className={`align-top ${booking.status === "CANCELLED" ? "text-muted" : ""}`}>
      <td className="px-4 py-3">
        <p dir="auto" className="break-words font-medium">
          {booking.name}
        </p>
        <p className="text-xs text-muted">
          Ref <span className="font-mono">{booking.reference}</span>
        </p>
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
        <StatusBadge status={booking.status} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-muted">
        {formatDateTime(booking.createdAt)}
      </td>
      <td className="px-4 py-3 text-right">
        <CancelAction booking={booking} error={error} onCancel={onCancel} align="end" />
      </td>
    </tr>
  );
}

/** The same booking for a narrow screen: everything stacked, Cancel in view. */
function BookingCard({ booking, error, onCancel }: RowProps) {
  return (
    <li
      className={`space-y-2 px-4 py-3 text-sm ${booking.status === "CANCELLED" ? "text-muted" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p dir="auto" className="break-words font-medium">
            {booking.name}
          </p>
          <p className="text-xs text-muted">
            Ref <span className="font-mono">{booking.reference}</span>
          </p>
        </div>
        <StatusBadge status={booking.status} />
      </div>
      <p dir="auto" className="break-words">
        {booking.property.title}
        <span className="block text-xs text-muted">{booking.property.slug}</span>
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted">Viewing</dt>
        <dd>{formatBookingWhen(booking.preferredDate, booking.preferredTime)}</dd>
        <dt className="text-muted">Phone</dt>
        <dd dir="ltr" className="text-left">
          {booking.phone}
        </dd>
        <dt className="text-muted">Booked</dt>
        <dd className="text-muted">{formatDateTime(booking.createdAt)}</dd>
      </dl>
      <div>
        <CancelAction booking={booking} error={error} onCancel={onCancel} align="start" />
      </div>
    </li>
  );
}

export function BookingsTable({ data }: { data: Page<BookingItem> }) {
  // One data source, one set of handlers; only the layout changes with the width.
  const wide = useMediaQuery(TABLE_QUERY, true);
  const cancel = useCancelBooking();
  const [cancelling, setCancelling] = useState<BookingItem | null>(null);
  /** An inline message per row (booking id): why its last cancel failed. */
  const [errors, setErrors] = useState<Record<string, string>>({});

  const clearError = (id: string) =>
    setErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

  const askToCancel = (booking: BookingItem) => {
    clearError(booking.id);
    setCancelling(booking);
  };

  async function confirmCancel(booking: BookingItem) {
    clearError(booking.id);
    try {
      await cancel.mutateAsync(booking.id);
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [booking.id]: describeError(error),
      }));
    } finally {
      setCancelling(null);
    }
  }

  if (data.total === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted">
        No bookings yet. Viewings booked through the chat will appear here.
      </p>
    );
  }

  return (
    <>
      {wide ? (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <caption className="sr-only">Property viewing bookings</caption>
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Visitor</th>
                <th scope="col" className="px-4 py-3 font-medium">Phone</th>
                <th scope="col" className="px-4 py-3 font-medium">Property</th>
                <th scope="col" className="px-4 py-3 font-medium">Preferred viewing</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Booked</th>
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((booking) => (
                <BookingRow
                  key={booking.id}
                  booking={booking}
                  error={errors[booking.id]}
                  onCancel={askToCancel}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul aria-label="Property viewing bookings" className="divide-y divide-border">
          {data.items.map((booking) => (
            <BookingCard
              key={booking.id}
              booking={booking}
              error={errors[booking.id]}
              onCancel={askToCancel}
            />
          ))}
        </ul>
      )}
      {cancelling ? (
        <CancelBookingDialog
          booking={cancelling}
          pending={cancel.isPending}
          onConfirm={() => void confirmCancel(cancelling)}
          onKeep={() => setCancelling(null)}
        />
      ) : null}
      <Pagination
        tab="bookings"
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
      />
    </>
  );
}
