import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Navbar from "./components/Navbar";
import CommandPalette from "./components/CommandPalette";
import LanguagePopup from "./components/LanguagePopup";

const inter = localFont({
  src: "../public/fonts/InterVariable.woff2",
  variable: "--font-inter",
  display: "swap",
});

const interDisplay = localFont({
  src: "../public/fonts/InterDisplay-Black.woff2",
  variable: "--font-inter-display",
  weight: "900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "myOCW",
  description:
    "OpenCourseWare, but yours. Not Affiliated with MIT by any means.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${inter.variable} ${interDisplay.variable} font-sans antialiased bg-zinc-50 dark:bg-zinc-950`}>
        <Navbar />
        <CommandPalette />
        <LanguagePopup />
        <div className="pt-20 min-h-screen">
          {children}
        </div>
        <footer className="border-t border-zinc-200 bg-zinc-50 px-6 py-8 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="mx-auto max-w-4xl text-center text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
            All resources on this site are adapted from{" "}
            <a href="https://ocw.mit.edu" target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-600 dark:hover:text-zinc-400">
              MIT OpenCourseWare
            </a>
            .
            <br />
            myOCW bears no affiliation to MIT in any way and is committed to remaining a not-for-profit, free and open-source (FOSS) platform.
          </p>
        </footer>
      </body>
    </html>
  );
}
