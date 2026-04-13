"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const STORAGE_PREFIX = "myocw:code:";
const SAVE_DELAY = 500;

export function useCodePersistence(courseId: number, psetId: string) {
  const key = `${STORAGE_PREFIX}${courseId}:${psetId}`;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [savedCode, setSavedCode] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(key);
  });

  // Sync if key changes
  useEffect(() => {
    setSavedCode(localStorage.getItem(key));
  }, [key]);

  const saveCode = useCallback(
    (code: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        localStorage.setItem(key, code);
        setSavedCode(code);
      }, SAVE_DELAY);
    },
    [key]
  );

  const clearSavedCode = useCallback(() => {
    localStorage.removeItem(key);
    setSavedCode(null);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, [key]);

  return { savedCode, saveCode, clearSavedCode };
}
