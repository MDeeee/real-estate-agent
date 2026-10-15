# Media for the README

The owner adds these files by hand (no generated images). The main README references them inside an HTML comment in its Demo section; uncomment those lines once the files exist.

Capture with the sample data seeded (`pnpm seed`) and a real LLM configured. Keep each image under about 1 MB; the GIF under about 10 MB.

| File | What to capture |
| --- | --- |
| `chat-demo.gif` | About 68 seconds in English (800 px wide, converted from the local raw video, which is git-ignored): a search ("3-bedroom villa for sale in Sheikh Zayed under 15 million"), the streamed answer with property cards, then a follow-up ("cheaper" or "tell me more about the second one"). |
| `chat-arabic.png` | An Arabic (Egyptian dialect) conversation with a right-to-left reply and cards, showing the agent answering in the visitor's language. |
| `search-compare.png` | The landing page on desktop: the chat on one side and the regular filter search on the other, both showing results for a similar request. |
| `admin-upload.png` | The admin dashboard after uploading several `.md` files: statuses `INDEXED`, one `FAILED` with its exact validation error, and a replace-or-skip conflict prompt if possible. |
| `admin-bookings.png` | The admin bookings list with at least one active booking made through the chat and one cancelled (muted) booking. Use invented names and a fake phone number. |
| `chat-booking.png` | Booking a viewing by chat, ending with the Viewing confirmed card. |
