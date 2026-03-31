"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, usePathname } from "next/navigation";
import { getUserLanguage } from "@/lib/queries/user-profile";
import type { User } from "@supabase/supabase-js";

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) getUserLanguage().then(setLanguage);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) getUserLanguage().then(setLanguage);
      else setLanguage(null);
    });

    return () => subscription.unsubscribe();
  }, [supabase.auth]);

  // Listen for language changes from LanguagePopup
  useEffect(() => {
    function onLanguageChange() {
      getUserLanguage().then(setLanguage);
    }
    window.addEventListener("language-changed", onLanguageChange);
    return () => window.removeEventListener("language-changed", onLanguageChange);
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  function isActive(path: string) {
    if (path === "/courses") return pathname.startsWith("/courses");
    return pathname === path;
  }

  const navLinkClass = (path: string) =>
    isActive(path)
      ? "text-[#810020] dark:text-[#ffb3b5] font-semibold border-b-2 border-[#810020] dark:border-[#ffb3b5] pb-1"
      : "text-zinc-600 dark:text-zinc-400 hover:text-[#810020] dark:hover:text-[#ffb3b5] transition-colors";

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] as const }}
      className="fixed top-0 z-50 w-full bg-white/80 backdrop-blur-md dark:bg-zinc-950/80"
    >
      <div className="mx-auto flex h-20 max-w-screen-2xl items-center justify-between px-6 md:px-12">
        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center">
            <Image
              src="/myocw.svg"
              alt="myOCW"
              width={120}
              height={30}
              priority
            />
          </Link>

          {user && (
            <nav className="hidden items-center gap-6 md:flex">
              <Link href="/courses" className={navLinkClass("/courses")}>
                Courses
              </Link>
              <Link href="/my-courses" className={navLinkClass("/my-courses")}>
                My Courses
              </Link>
              <Link href="/curricula" className={navLinkClass("/curricula")}>
                Pathways
              </Link>
              <Link href="/account" className={navLinkClass("/account")}>
                Account
              </Link>
            </nav>
          )}
        </div>

        {/* Right: Search + Theme + Auth */}
        <div className="flex items-center gap-4">
          {user && language && (
            <button
              onClick={() => window.dispatchEvent(new Event("open-language-popup"))}
              className="hidden items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 md:flex"
            >
              {language}
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
          )}
          {user && (
            <div className="relative hidden md:block">
              <svg
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <button
                onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
                className="flex w-64 items-center rounded-lg bg-[#f3f4f5] py-2 pl-10 pr-3 text-left text-sm text-zinc-400 transition-all hover:bg-[#edeeef] focus:ring-2 focus:ring-[#810020] dark:bg-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-800"
              >
                <span>Search courses...</span>
                <kbd className="ml-auto rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium leading-none text-zinc-400 dark:bg-zinc-700 dark:text-zinc-500">
                  ⌘K
                </kbd>
              </button>
            </div>
          )}

          <button
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            className="rounded-full p-2 text-zinc-600 transition-all hover:bg-[#f3f4f5] dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {isDark ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
              </svg>
            )}
          </button>

          {user ? (
            <button
              onClick={handleSignOut}
              className="rounded-full p-2 text-zinc-600 transition-all hover:bg-[#f3f4f5] dark:text-zinc-400 dark:hover:bg-zinc-800"
              aria-label="Sign out"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
              </svg>
            </button>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-gradient-to-br from-[#810020] to-[#a31f34] px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </motion.header>
  );
}
