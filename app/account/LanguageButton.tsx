"use client";

import { useEffect, useState } from "react";
import { getUserLanguage } from "@/lib/queries/user-profile";

export default function LanguageButton() {
  const [language, setLanguage] = useState<string | null>(null);

  useEffect(() => {
    getUserLanguage().then(setLanguage);
  }, []);

  useEffect(() => {
    function handleChanged() {
      getUserLanguage().then(setLanguage);
    }
    window.addEventListener("language-changed", handleChanged);
    return () => window.removeEventListener("language-changed", handleChanged);
  }, []);

  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Language
        </h3>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          {language ?? "Not set"}
        </p>
      </div>
      <button
        onClick={() => window.dispatchEvent(new Event("open-language-popup"))}
        className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
      >
        Change
      </button>
    </div>
  );
}
