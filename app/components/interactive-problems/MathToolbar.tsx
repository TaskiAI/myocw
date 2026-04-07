"use client";

import { useState, useCallback } from "react";
import {
  KeyboardMemory,
  LatexConfiguration,
  insert,
  getEditModeLatex,
  getViewModeLatex,
  StandardLeafNode,
  StandardBranchingNode,
  DescendingBranchingNode,
  AscendingBranchingNode,
  MatrixNode,
} from "mathkeyboardengine";

const latexConfig = new LatexConfiguration();
latexConfig.activePlaceholderShape = String.raw`\blacksquare`;
latexConfig.passivePlaceholderShape = String.raw`\square`;

interface MathToolbarProps {
  keyboardMemory: KeyboardMemory | null;
  onUpdate: () => void;
}

interface ToolbarButton {
  label: string;
  latex?: string;
  title: string;
  action: (km: KeyboardMemory) => void;
}

const STRUCTURE_BUTTONS: ToolbarButton[] = [
  {
    label: "x/y",
    title: "Fraction",
    action: (km) => insert(km, new DescendingBranchingNode(String.raw`\frac{`, "}{", "}")),
  },
  {
    label: "√",
    title: "Square root",
    action: (km) => insert(km, new StandardBranchingNode(String.raw`\sqrt{`, "}")),
  },
  {
    label: "xⁿ",
    title: "Superscript / power",
    action: (km) => insert(km, new AscendingBranchingNode("", "^{", "}")),
  },
  {
    label: "xₙ",
    title: "Subscript",
    action: (km) => insert(km, new DescendingBranchingNode("", "_{", "}")),
  },
  {
    label: "()",
    title: "Parentheses",
    action: (km) => insert(km, new StandardBranchingNode(String.raw`\left(`, String.raw`\right)`)),
  },
  {
    label: "||",
    title: "Absolute value",
    action: (km) => insert(km, new StandardBranchingNode(String.raw`\left|`, String.raw`\right|`)),
  },
];

const OPERATOR_BUTTONS: ToolbarButton[] = [
  { label: "±", title: "Plus-minus", action: (km) => insert(km, new StandardLeafNode(String.raw`\pm`)) },
  { label: "·", title: "Dot multiply", action: (km) => insert(km, new StandardLeafNode(String.raw`\cdot`)) },
  { label: "×", title: "Cross multiply", action: (km) => insert(km, new StandardLeafNode(String.raw`\times`)) },
  { label: "÷", title: "Divide", action: (km) => insert(km, new StandardLeafNode(String.raw`\div`)) },
  { label: "≤", title: "Less than or equal", action: (km) => insert(km, new StandardLeafNode(String.raw`\leq`)) },
  { label: "≥", title: "Greater than or equal", action: (km) => insert(km, new StandardLeafNode(String.raw`\geq`)) },
  { label: "≠", title: "Not equal", action: (km) => insert(km, new StandardLeafNode(String.raw`\neq`)) },
  { label: "∞", title: "Infinity", action: (km) => insert(km, new StandardLeafNode(String.raw`\infty`)) },
];

const GREEK_BUTTONS: ToolbarButton[] = [
  { label: "α", title: "Alpha", action: (km) => insert(km, new StandardLeafNode(String.raw`\alpha`)) },
  { label: "β", title: "Beta", action: (km) => insert(km, new StandardLeafNode(String.raw`\beta`)) },
  { label: "γ", title: "Gamma", action: (km) => insert(km, new StandardLeafNode(String.raw`\gamma`)) },
  { label: "δ", title: "Delta", action: (km) => insert(km, new StandardLeafNode(String.raw`\delta`)) },
  { label: "θ", title: "Theta", action: (km) => insert(km, new StandardLeafNode(String.raw`\theta`)) },
  { label: "λ", title: "Lambda", action: (km) => insert(km, new StandardLeafNode(String.raw`\lambda`)) },
  { label: "μ", title: "Mu", action: (km) => insert(km, new StandardLeafNode(String.raw`\mu`)) },
  { label: "π", title: "Pi", action: (km) => insert(km, new StandardLeafNode(String.raw`\pi`)) },
  { label: "σ", title: "Sigma", action: (km) => insert(km, new StandardLeafNode(String.raw`\sigma`)) },
  { label: "φ", title: "Phi", action: (km) => insert(km, new StandardLeafNode(String.raw`\phi`)) },
  { label: "ω", title: "Omega", action: (km) => insert(km, new StandardLeafNode(String.raw`\omega`)) },
];

const CALCULUS_BUTTONS: ToolbarButton[] = [
  {
    label: "∫",
    title: "Integral",
    action: (km) => insert(km, new StandardBranchingNode(String.raw`\int_{`, "}^{", "}")),
  },
  {
    label: "Σ",
    title: "Summation",
    action: (km) => insert(km, new StandardBranchingNode(String.raw`\sum_{`, "}^{", "}")),
  },
  {
    label: "∏",
    title: "Product",
    action: (km) => insert(km, new StandardBranchingNode(String.raw`\prod_{`, "}^{", "}")),
  },
  {
    label: "lim",
    title: "Limit",
    action: (km) => insert(km, new StandardBranchingNode(String.raw`\lim_{`, "}")),
  },
  {
    label: "∂",
    title: "Partial derivative",
    action: (km) => insert(km, new StandardLeafNode(String.raw`\partial`)),
  },
  {
    label: "∇",
    title: "Nabla / gradient",
    action: (km) => insert(km, new StandardLeafNode(String.raw`\nabla`)),
  },
];

const MAX_MATRIX_DIM = 10;

function ToolbarGroup({
  label,
  buttons,
  km,
  onUpdate,
}: {
  label: string;
  buttons: ToolbarButton[];
  km: KeyboardMemory;
  onUpdate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      <span className="mr-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {label}
      </span>
      {buttons.map((btn) => (
        <button
          key={btn.title}
          type="button"
          title={btn.title}
          onMouseDown={(e) => {
            e.preventDefault(); // Keep focus on MathInput
            btn.action(km);
            onUpdate();
          }}
          className="flex h-8 min-w-[2rem] items-center justify-center rounded border border-zinc-200 bg-white px-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 active:bg-zinc-200 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
}

export default function MathToolbar({ keyboardMemory, onUpdate }: MathToolbarProps) {
  const [showMatrix, setShowMatrix] = useState(false);
  const [matrixRows, setMatrixRows] = useState(2);
  const [matrixCols, setMatrixCols] = useState(2);
  const km = keyboardMemory;

  const handleMatrixInsert = useCallback(
    (rows: number, cols: number) => {
      if (!km) return;
      insert(km, new MatrixNode("bmatrix", cols, rows));
      setShowMatrix(false);
      onUpdate();
    },
    [km, onUpdate]
  );

  if (!km) return null;

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/50">
      <ToolbarGroup label="Structure" buttons={STRUCTURE_BUTTONS} km={km} onUpdate={onUpdate} />
      <ToolbarGroup label="Operators" buttons={OPERATOR_BUTTONS} km={km} onUpdate={onUpdate} />
      <ToolbarGroup label="Greek" buttons={GREEK_BUTTONS} km={km} onUpdate={onUpdate} />
      <ToolbarGroup label="Calculus" buttons={CALCULUS_BUTTONS} km={km} onUpdate={onUpdate} />

      {/* Matrix button with n×m picker */}
      <div className="relative flex items-center gap-0.5">
        <span className="mr-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Matrix
        </span>
        <button
          type="button"
          title="Insert matrix"
          onMouseDown={(e) => {
            e.preventDefault();
            setShowMatrix((v) => !v);
          }}
          className="flex h-8 min-w-[2rem] items-center justify-center rounded border border-zinc-200 bg-white px-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 active:bg-zinc-200 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
        >
          [ ]
        </button>
        {showMatrix && (
          <div className="absolute top-full left-0 z-50 mt-1 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-600 dark:bg-zinc-800">
            <div className="flex items-center gap-2">
              <label className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500">Rows</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_MATRIX_DIM}
                  value={matrixRows}
                  onChange={(e) => setMatrixRows(Math.max(1, Math.min(MAX_MATRIX_DIM, Number(e.target.value) || 1)))}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="w-12 rounded border border-zinc-300 px-1.5 py-1 text-center text-sm text-zinc-700 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200"
                />
              </label>
              <span className="mt-4 text-sm text-zinc-400">×</span>
              <label className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500">Cols</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_MATRIX_DIM}
                  value={matrixCols}
                  onChange={(e) => setMatrixCols(Math.max(1, Math.min(MAX_MATRIX_DIM, Number(e.target.value) || 1)))}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="w-12 rounded border border-zinc-300 px-1.5 py-1 text-center text-sm text-zinc-700 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200"
                />
              </label>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleMatrixInsert(matrixRows, matrixCols);
                }}
                className="mt-4 rounded bg-[#750014] px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-[#5a0010]"
              >
                Insert
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
