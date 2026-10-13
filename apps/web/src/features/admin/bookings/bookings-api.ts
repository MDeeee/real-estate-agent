import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { request } from "@/shared/api/http";
import { pageSchema, type Page } from "@/shared/api/page";
import { ADMIN_PAGE_SIZE } from "../constants";
import { bookingItemSchema, type BookingItem } from "./schemas";

export const bookingKeys = {
  all: ["admin", "bookings"] as const,
  list: (page: number) => [...bookingKeys.all, page] as const,
};

export function useBookings(page: number) {
  return useQuery({
    queryKey: bookingKeys.list(page),
    queryFn: ({ signal }) =>
      request(
        `/admin/bookings?page=${page}&pageSize=${ADMIN_PAGE_SIZE}`,
        pageSchema(bookingItemSchema),
        { signal },
      ),
    placeholderData: keepPreviousData,
  });
}

/**
 * Cancels a booking. The returned booking replaces the cached row at once and
 * the lists are refetched, so the row shows CANCELLED without a reload.
 */
export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request(
        `/admin/bookings/${encodeURIComponent(id)}/cancel`,
        bookingItemSchema,
        { method: "POST" },
      ),
    onSuccess: (updated) => {
      queryClient.setQueriesData<Page<BookingItem>>(
        { queryKey: bookingKeys.all },
        (page) =>
          page && {
            ...page,
            items: page.items.map((item) =>
              item.id === updated.id ? updated : item,
            ),
          },
      );
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: bookingKeys.all }),
  });
}
