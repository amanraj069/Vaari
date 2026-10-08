import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, Noto_Sans_Devanagari, Noto_Sans_Gurmukhi } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "@/components/providers";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz"], display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const gurmukhi = Noto_Sans_Gurmukhi({ subsets: ["gurmukhi"], variable: "--font-gurmukhi", display: "swap" });
const devanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-devanagari", display: "swap" });

export const metadata: Metadata = {
  title: "Vaari: your turn, guaranteed",
  description: "A promised Super Seeder date for every farmer, so nobody burns stubble while waiting. Simulated demo season.",
};

export const viewport: Viewport = { themeColor: "#f5f0e4", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} className={`${fraunces.variable} ${inter.variable} ${gurmukhi.variable} ${devanagari.variable}`}>
      <body className="min-h-dvh">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
