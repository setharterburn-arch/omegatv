import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Omega TV | Premium Streaming",
  description: "Stream unlimited entertainment with Omega TV. Live TV, movies, and shows on any device.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
