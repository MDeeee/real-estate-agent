import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { request } from "@/shared/api/http";
import { pageSchema } from "@/shared/api/page";
import { ADMIN_PAGE_SIZE } from "../constants";
import { bookingItemSchema } from "./schemas";

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
