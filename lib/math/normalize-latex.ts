/**
 * LaTeX normalization for answer comparison.
 * Strips whitespace, normalizes common equivalent forms.
 */
export function normalizeLatex(latex: string): string {
  let s = latex.trim();
  // Remove \displaystyle, \textstyle wrappers
  s = s.replace(/\\(displaystyle|textstyle)\s*/g, "");
  // Normalize whitespace around operators
  s = s.replace(/\s+/g, " ");
  // Remove trailing/leading spaces inside braces
  s = s.replace(/\{\s+/g, "{").replace(/\s+\}/g, "}");
  // Remove empty groups
  s = s.replace(/\{\}/g, "");
  // Normalize \left( \right) → ( )
  s = s.replace(/\\left\s*\(/g, "(").replace(/\\right\s*\)/g, ")");
  s = s.replace(/\\left\s*\[/g, "[").replace(/\\right\s*\]/g, "]");
  // Normalize \cdot → *
  s = s.replace(/\\cdot/g, "*");
  // Normalize \times → *
  s = s.replace(/\\times/g, "*");
  return s.trim();
}

export function latexAnswersMatch(userLatex: string, correctAnswer: string): boolean {
  return normalizeLatex(userLatex) === normalizeLatex(correctAnswer);
}
