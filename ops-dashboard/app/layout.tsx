import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai, Inter } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

const thai = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  variable: "--font-thai",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Thailand Transport Safety Ops",
  description: "Thailand/SEA smart city transport safety operations dashboard",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body className={`${inter.variable} ${thai.variable}`}>{children}</body>
    </html>
  );
}
