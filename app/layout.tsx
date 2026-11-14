import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "E91 | QKD Simulator",
  description:
    "An interactive entanglement-based quantum key distribution laboratory simulator.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
