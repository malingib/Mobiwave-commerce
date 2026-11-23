import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MobiWave Commerce | Your business, online",
  description:
    "Create your online shop, manage products and orders, and keep customers informed with MobiWave Commerce — built for Kenyan businesses.",
  metadataBase: new URL("https://mobiwave-commerce.vercel.app"),
  openGraph: {
    type: "website",
    locale: "en_KE",
    siteName: "MobiWave Commerce",
    title: "MobiWave Commerce | Your business, online",
    description:
      "Create your online shop, manage products and orders, and keep customers informed with MobiWave Commerce.",
    url: "https://mobiwave-commerce.vercel.app",
    images: [{ url: "/branding/martex-hero-nobg.webp", alt: "MobiWave customer engagement illustration" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MobiWave Commerce | Your business, online",
    description:
      "Create your online shop, manage products and orders, and keep customers informed with MobiWave Commerce.",
    images: ["/branding/martex-hero-nobg.webp"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-KE">
      <body>{children}</body>
    </html>
  );
}
