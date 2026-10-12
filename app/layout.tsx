import type { Metadata, Viewport } from "next";
import "./globals.css";

const description = "Answer a few questions, paddle the rapids, unlock leads that fit. Open source, bring your own AI Ark key.";
const image = { url: "/og.png", width: 1200, height: 630, alt: "Timnu, the oracle of recurring revenue, alone on her island, pointing her cane toward a sign that says LEADS." };

export const metadata: Metadata = {
  metadataBase: new URL("https://www.timnu.com"),
  title: "Timnu — the oracle of recurring revenue",
  description,
  openGraph: { title: "Timnu — the oracle of recurring revenue", description, type: "website", images: [image] },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  twitter: { card: "summary_large_image", title: "Timnu — the oracle of recurring revenue", description, images: [image] },
};

export const viewport: Viewport = { themeColor: "#0b1026", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,700;1,9..144,400&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
