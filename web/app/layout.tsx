import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai, Space_Grotesk } from "next/font/google";
import "./globals.css";

const heading = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
  weight: ["500", "700"],
});

const body = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  variable: "--font-body",
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Seed Research by SEEDY | Verifiable Thai Research",
  description: "Discover Thai research, learn from evidence, and verify every AI answer against the original page.",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${heading.variable} ${body.variable}`}>{children}</body>
    </html>
  );
}
