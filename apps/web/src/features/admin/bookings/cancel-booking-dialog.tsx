import { useEffect, useRef } from "react";
import { formatBookingDate } from "@/shared/lib/booking-when";
import { Button } from "@/shared/ui/button";
import type { BookingItem } from "./schemas";

/**
 * Asks the admin to confirm cancelling one booking. A native modal
 * `<dialog>`: the browser traps focus, makes the page behind it inert and
 * closes it on Escape (treated as "Keep"). Focus starts on "Keep", the safe
 * answer; the heading is what a screen reader announces.
 */
export function CancelBookingDialog({
  booking,
  pending,
  onConfirm,
  onKeep,
}: {
  booking: BookingItem;
  pending: boolean;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    keepRef.current?.focus();
    return () => dialog?.close();
  }, []);

  const details: [string, string, "auto" | "ltr"][] = [
    ["Reference", booking.reference, "ltr"],
    ["Property", booking.property.title, "auto"],
    ["Date", formatBookingDate(booking.preferredDate), "ltr"],
    ["Time", booking.preferredTime ?? "Any time", "ltr"],
    ["Name", booking.name, "auto"],
  ];

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="cancel-booking-title"
      aria-describedby="cancel-booking-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onKeep();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-border bg-surface p-0 text-foreground backdrop:bg-black/50"
    >
      <div className="p-4 sm:p-6">
        <h2 id="cancel-booking-title" className="text-lg font-semibold">
          Cancel this booking?
        </h2>
        <p id="cancel-booking-description" className="mt-1 text-sm text-muted">
          The viewing is marked as cancelled and its time slot is not offered
          to this visitor again. This cannot be undone.
        </p>
        <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {details.map(([label, value, dir]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd dir={dir} className="break-words font-medium">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={keepRef} disabled={pending} onClick={onKeep}>
            Keep
          </Button>
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            {pending ? "Cancelling…" : "Cancel booking"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
