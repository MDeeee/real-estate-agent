import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Real-estate AI agent",
  description:
    "Ask an AI assistant about Egyptian property listings and compare it with a regular filter search.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
