"use client";

import { useEffect, useRef, useCallback } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
}

// Light theme that matches the app's zinc palette
const lightTheme = EditorView.theme({
  "&": {
    backgroundColor: "#fafafa",
    color: "#18181b",
  },
  ".cm-gutters": {
    backgroundColor: "#f4f4f5",
    color: "#a1a1aa",
    borderRight: "1px solid #e4e4e7",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#e4e4e7",
  },
  ".cm-activeLine": {
    backgroundColor: "#f4f4f510",
  },
});

export default function CodeEditor({ value, onChange, onRun }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const isDark = useCallback(() => {
    return document.documentElement.classList.contains("dark");
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const runKeymap = keymap.of([
      {
        key: "Mod-Enter",
        run: () => {
          onRun?.();
          return true;
        },
      },
    ]);

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        python(),
        runKeymap,
        themeCompartment.current.of(isDark() ? oneDark : lightTheme),
        updateListener,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;

    // Watch for dark mode changes
    const observer = new MutationObserver(() => {
      view.dispatch({
        effects: themeCompartment.current.reconfigure(
          isDark() ? oneDark : lightTheme
        ),
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      observer.disconnect();
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle external value changes (e.g., reset)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentValue = view.state.doc.toString();
    if (currentValue !== value) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentValue.length,
          insert: value,
        },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700 [&_.cm-editor]:h-full [&_.cm-editor]:outline-none [&_.cm-scroller]:font-mono [&_.cm-scroller]:text-sm"
    />
  );
}
