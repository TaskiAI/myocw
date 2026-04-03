"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getUserLanguage, setUserLanguage } from "@/lib/queries/user-profile";
import { LANGUAGE_NAMES } from "@/lib/languages";

const LANGUAGES = [...LANGUAGE_NAMES, "Other"];

export default function LanguagePopup() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Auto-open on first visit if no language set
  useEffect(() => {
    let cancelled = false;
    async function check() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const lang = await getUserLanguage();
      if (!cancelled && !lang) {
        setOpen(true);
      }
    }
    check();
    return () => { cancelled = true; };
  }, []);

  // Allow external code to reopen the popup
  useEffect(() => {
    function handleOpen() {
      getUserLanguage().then((lang) => {
        setSelected(lang ?? null);
        setOpen(true);
      });
    }
    window.addEventListener("open-language-popup", handleOpen);
    return () => window.removeEventListener("open-language-popup", handleOpen);
  }, []);

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    await setUserLanguage(selected);
    window.dispatchEvent(new Event("language-changed"));
    setOpen(false);
    setSaving(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          What&apos;s your preferred language?
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          This helps us personalize your experience.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {LANGUAGES.map((lang) => (
            <button
              key={lang}
              onClick={() => setSelected(lang)}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                selected === lang
                  ? "border-[#750014] bg-[#750014]/10 font-medium text-[#750014] dark:border-[#ff4d6a] dark:bg-[#ff4d6a]/10 dark:text-[#ff4d6a]"
                  : "border-zinc-200 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
              }`}
            >
              {lang}
            </button>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg px-4 py-2 text-sm text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Skip
          </button>
          <button
            onClick={handleSave}
            disabled={!selected || saving}
            className="rounded-lg bg-[#750014] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#5a0010] disabled:opacity-50"
          >
            {saving ? "Saving..." : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
