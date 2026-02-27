import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import "./globals.css";
import Navbar from "./components/Navbar";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "myOCW — Personalized MIT OpenCourseWare",
  description:
    "Track your progress through MIT OpenCourseWare courses and work through problem sets interactively.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${instrumentSans.variable} font-sans antialiased bg-zinc-50`}>
        <Navbar />
        {children}
      </body>
    </html>
  );
}
