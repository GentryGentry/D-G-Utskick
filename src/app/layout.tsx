import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "D&G Utskick", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="sv"><body><main>{children}</main></body></html>;
}
