-- `preferredDate` becomes a calendar date (no time of day, no time zone) and
-- the viewing gets an optional `preferredTime` ("HH:mm", business time zone).
--
-- Existing values are instants. The day the visitor meant is the date in the
-- business time zone (Africa/Cairo), so the instant is read as UTC and
-- converted before it is cut to a date; a plain cast would use the session
-- time zone and could move a late-evening UTC instant to the wrong day.

-- Cutting instants down to days can make two bookings of the same thread and
-- property land on one day, which the unique index created by the previous
-- migration ("threadId", "propertyId", "preferredDate") would reject and fail
-- the whole migration. Keep the newest booking of each such group. Rows
-- without a thread never collide (NULLs are distinct in the index), so they
-- are left alone.
DELETE FROM "Booking"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY
          "threadId",
          "propertyId",
          (("preferredDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Cairo')::date
        ORDER BY "createdAt" DESC, "id" DESC
      ) AS "rank"
    FROM "Booking"
    WHERE "threadId" IS NOT NULL
  ) AS "ranked"
  WHERE "rank" > 1
);

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "preferredTime" TEXT,
ALTER COLUMN "preferredDate" SET DATA TYPE DATE
  USING (("preferredDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Cairo')::date;
