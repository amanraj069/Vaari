import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, Noto_Sans_Devanagari, Noto_Sans_Gurmukhi, Noto_Serif_Devanagari, Noto_Serif_Gurmukhi } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "@/components/providers";
import { THEME_BOOT_SCRIPT, ThemeProvider } from "@/contexts/theme-context";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz"], display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const gurmukhi = Noto_Sans_Gurmukhi({ subsets: ["gurmukhi"], variable: "--font-gurmukhi", display: "swap" });
const devanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-devanagari", display: "swap" });
// Fraunces has only Latin subsets, so Punjabi and Hindi headings would fall back to an OS serif.
// These cover display text only; body text keeps the Noto Sans faces above.
const serifGurmukhi = Noto_Serif_Gurmukhi({ subsets: ["gurmukhi"], variable: "--font-serif-gurmukhi", display: "swap" });
const serifDevanagari = Noto_Serif_Devanagari({ subsets: ["devanagari"], variable: "--font-serif-devanagari", display: "swap" });

export const metadata: Metadata = {
  title: "Vaari: your turn, guaranteed",
  description: "A promised Super Seeder date for every farmer, so nobody burns stubble while waiting. Simulated demo season.",
  // Square icons cut from public/icon.png and icon-d.png (never stretched). The SVG switches
  // between the black and white harvester with the browser's colour scheme; the ICO is the
  // fallback for browsers without SVG favicons.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f0e4" },
    { media: "(prefers-color-scheme: dark)", color: "#16140f" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    // suppressHydrationWarning: the boot script sets the theme class before React hydrates.
    <html lang={locale} className={`${fraunces.variable} ${inter.variable} ${gurmukhi.variable} ${devanagari.variable} ${serifGurmukhi.variable} ${serifDevanagari.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <ThemeProvider>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <Providers>{children}</Providers>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
