-- CreateIndex
CREATE UNIQUE INDEX "Booking_threadId_propertyId_preferredDate_key" ON "Booking"("threadId", "propertyId", "preferredDate");
