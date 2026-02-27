"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [supabase.auth]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-zinc-100 bg-white/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center">
          <Image
            src="/myocw.svg"
            alt="myOCW"
            width={120}
            height={30}
            priority
          />
        </Link>

        <div className="flex items-center gap-8">
          {user && (
            <>
              <Link
                href="/courses"
                className="text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900"
              >
                All Courses
              </Link>
              <Link
                href="/my-courses"
                className="text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900"
              >
                My Courses
              </Link>
              <Link
                href="/curricula"
                className="text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900"
              >
                Curricula
              </Link>
            </>
          )}
          {user ? (
            <button
              onClick={handleSignOut}
              className="text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900"
            >
              Sign Out
            </button>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-[#750014] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#5a0010]"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
