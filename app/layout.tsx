import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-grotesk",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Microcosm — Simulate the market before you build for it.",
  description:
    "Microcosm seeds thousands of persona-grounded AI agents — buyers, renters, neighbors, lenders, investors — that react, debate, and change their minds. Then it hands you the report, before a single dollar of capital is committed.",
};

const themeInit = `try{var t=localStorage.getItem("mc-theme")||"dark";document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className={`${grotesk.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
