"use client";

import {
  useRef,
  useEffect,
  useCallback,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  KeyboardMemory,
  LatexConfiguration,
  insert,
  deleteLeft,
  deleteRight,
  moveLeft,
  moveRight,
  moveUp,
  moveDown,
  getEditModeLatex,
  getViewModeLatex,
  DigitNode,
  StandardLeafNode,
  StandardBranchingNode,
  DescendingBranchingNode,
  AscendingBranchingNode,
} from "mathkeyboardengine";
import katex from "katex";

const latexConfig = new LatexConfiguration();
latexConfig.activePlaceholderShape = String.raw`\rule{1.5px}{1.2em}`;
latexConfig.activePlaceholderColor = "#750014";
latexConfig.passivePlaceholderShape = String.raw`\square`;

interface MathInputProps {
  value?: string;
  onChange?: (latex: string) => void;
  onKeyboardMemoryReady?: (km: KeyboardMemory) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  /** Bump this to force re-render after external KM mutations (e.g. toolbar) */
  renderTrigger?: number;
}

export default function MathInput({
  value,
  onChange,
  onKeyboardMemoryReady,
  placeholder = "Type math here...",
  className = "",
  disabled = false,
  fullWidth = false,
  renderTrigger = 0,
}: MathInputProps) {
  const kmRef = useRef<KeyboardMemory | null>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Initialize KeyboardMemory once
  useEffect(() => {
    const km = new KeyboardMemory();
    kmRef.current = km;
    onKeyboardMemoryReady?.(km);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderDisplay = useCallback(() => {
    const km = kmRef.current;
    const el = displayRef.current;
    if (!km || !el) return;

    const latex = focused
      ? getEditModeLatex(km, latexConfig)
      : getViewModeLatex(km, latexConfig);

    const viewLatex = getViewModeLatex(km, latexConfig);
    setIsEmpty(viewLatex.trim().length === 0);

    try {
      katex.render(latex || String.raw`\phantom{x}`, el, {
        throwOnError: false,
        displayMode: false,
        trust: true,
        output: "htmlAndMathml",
      });
    } catch {
      el.textContent = latex;
    }
  }, [focused]);

  const emitChange = useCallback(() => {
    const km = kmRef.current;
    if (!km) return;
    const latex = getViewModeLatex(km, latexConfig);
    onChangeRef.current?.(latex);
  }, []);

  // Re-render when focus changes or renderTrigger bumps
  useEffect(() => {
    renderDisplay();
    emitChange();
  }, [focused, renderTrigger, renderDisplay, emitChange]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const km = kmRef.current;
      if (!km) return;

      const { key, shiftKey, ctrlKey, metaKey } = e;

      // Let browser handle copy/paste/select-all
      if ((ctrlKey || metaKey) && (key === "c" || key === "v" || key === "a")) return;

      e.preventDefault();

      if (key === "Backspace") {
        deleteLeft(km);
      } else if (key === "Delete") {
        deleteRight(km);
      } else if (key === "ArrowLeft") {
        moveLeft(km);
      } else if (key === "ArrowRight") {
        moveRight(km);
      } else if (key === "ArrowUp") {
        moveUp(km);
      } else if (key === "ArrowDown") {
        moveDown(km);
      } else if (key === "/" || (shiftKey && key === "/")) {
        insert(km, new DescendingBranchingNode(String.raw`\frac{`, "}{", "}"));
      } else if (key === "^") {
        insert(km, new AscendingBranchingNode("", "^{", "}"));
      } else if (key === "_") {
        insert(km, new DescendingBranchingNode("", "_{", "}"));
      } else if (key === "(") {
        insert(km, new StandardBranchingNode(String.raw`\left(`, String.raw`\right)`));
      } else if (key === "[") {
        insert(km, new StandardBranchingNode(String.raw`\left[`, String.raw`\right]`));
      } else if (key.length === 1 && /[0-9]/.test(key)) {
        insert(km, new DigitNode(key));
      } else if (key === ".") {
        insert(km, new StandardLeafNode("."));
      } else if (key === ",") {
        insert(km, new StandardLeafNode(","));
      } else if (key === "+") {
        insert(km, new StandardLeafNode("+"));
      } else if (key === "-") {
        insert(km, new StandardLeafNode("-"));
      } else if (key === "*") {
        insert(km, new StandardLeafNode(String.raw`\cdot`));
      } else if (key === "=") {
        insert(km, new StandardLeafNode("="));
      } else if (key === "<") {
        insert(km, new StandardLeafNode("<"));
      } else if (key === ">") {
        insert(km, new StandardLeafNode(">"));
      } else if (key === "!") {
        insert(km, new StandardLeafNode("!"));
      } else if (key === "|") {
        insert(km, new StandardLeafNode("|"));
      } else if (key.length === 1 && /[a-zA-Z]/.test(key)) {
        insert(km, new StandardLeafNode(key));
      } else {
        return;
      }

      renderDisplay();
      emitChange();
    },
    [disabled, renderDisplay, emitChange]
  );

  return (
    <div
      ref={displayRef}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={handleKeyDown}
      onFocus={useCallback(() => setFocused(true), [])}
      onBlur={useCallback(() => setFocused(false), [])}
      className={`
        math-input relative min-h-[2.5rem] cursor-text rounded-lg border px-3 py-2 text-base
        flex items-center
        ${focused
          ? "border-[#750014] ring-1 ring-[#750014]"
          : "border-zinc-300 dark:border-zinc-600"
        }
        ${disabled
          ? "cursor-not-allowed bg-zinc-100 dark:bg-zinc-800"
          : "bg-white dark:bg-zinc-800"
        }
        ${fullWidth ? "w-full" : "inline-block min-w-[8rem]"}
        text-zinc-900 dark:text-zinc-100
        ${isEmpty && !focused ? "text-zinc-400 dark:text-zinc-500" : ""}
        ${className}
      `}
      role="textbox"
      aria-label="Math input"
      data-placeholder={placeholder}
    />
  );
}
