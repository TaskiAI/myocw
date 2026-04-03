export type ComponentType = "FillInBlank" | "MultipleChoice" | "FreeResponse";

export interface ComponentSlot {
  index: number;
  type: ComponentType;
  answer: string;
  options?: string[];  // MultipleChoice only
  prompt?: string;     // FreeResponse only
}

const COMP_PLACEHOLDER_PREFIX = "\uE002COMP";
const COMP_PLACEHOLDER_SUFFIX = "\uE003";

export function compPlaceholder(index: number): string {
  return `${COMP_PLACEHOLDER_PREFIX}${index}${COMP_PLACEHOLDER_SUFFIX}`;
}

export function parseCompPlaceholderAt(
  source: string,
  startIndex: number
): { slotIndex: number; endIndex: number } | null {
  if (!source.startsWith(COMP_PLACEHOLDER_PREFIX, startIndex)) return null;

  const suffixPos = source.indexOf(
    COMP_PLACEHOLDER_SUFFIX,
    startIndex + COMP_PLACEHOLDER_PREFIX.length
  );
  if (suffixPos === -1) return null;

  const indexText = source.slice(
    startIndex + COMP_PLACEHOLDER_PREFIX.length,
    suffixPos
  );
  if (!/^\d+$/.test(indexText)) return null;

  return {
    slotIndex: Number(indexText),
    endIndex: suffixPos + COMP_PLACEHOLDER_SUFFIX.length,
  };
}

/**
 * Parse a prop value that may be a quoted string or a JSX-style array.
 * Returns the value and the index after the closing delimiter.
 */
function parsePropValue(
  propsStr: string,
  startIndex: number
): { value: string | string[]; endIndex: number } | null {
  const ch = propsStr[startIndex];

  // JSX array: options={["a","b","c"]}
  if (ch === "{") {
    const closeBrace = propsStr.indexOf("}", startIndex);
    if (closeBrace === -1) return null;
    const inner = propsStr.slice(startIndex + 1, closeBrace).trim();
    try {
      const parsed = JSON.parse(inner);
      if (Array.isArray(parsed)) {
        return { value: parsed as string[], endIndex: closeBrace + 1 };
      }
    } catch {
      // fall through
    }
    return null;
  }

  // Quoted string: answer="value" or answer='value'
  if (ch === '"' || ch === "'") {
    const closeQuote = ch;
    let end = startIndex + 1;
    while (end < propsStr.length && propsStr[end] !== closeQuote) {
      end++;
    }
    if (end >= propsStr.length) return null;
    const inner = propsStr.slice(startIndex + 1, end);
    // Try to parse as JSON array (e.g. options='["a","b"]')
    try {
      const parsed = JSON.parse(inner);
      if (Array.isArray(parsed)) {
        return { value: parsed as string[], endIndex: end + 1 };
      }
    } catch {
      // Not JSON — treat as plain string
    }
    return { value: inner, endIndex: end + 1 };
  }

  return null;
}

function parseProps(
  propsStr: string
): Record<string, string | string[]> {
  const props: Record<string, string | string[]> = {};
  let i = 0;

  while (i < propsStr.length) {
    // Skip whitespace
    while (i < propsStr.length && /\s/.test(propsStr[i])) i++;
    if (i >= propsStr.length) break;

    // Read key
    const keyStart = i;
    while (i < propsStr.length && propsStr[i] !== "=" && !/\s/.test(propsStr[i])) i++;
    const key = propsStr.slice(keyStart, i);
    if (!key) break;

    // Skip whitespace + equals
    while (i < propsStr.length && /\s/.test(propsStr[i])) i++;
    if (propsStr[i] !== "=") continue;
    i++; // skip =
    while (i < propsStr.length && /\s/.test(propsStr[i])) i++;

    const result = parsePropValue(propsStr, i);
    if (!result) break;

    props[key] = result.value;
    i = result.endIndex;
  }

  return props;
}

const TAG_REGEX =
  /<(FillInBlank|MultipleChoice|FreeResponse)(\s[\s\S]*?)?\/>/g;

/**
 * Extract interactive component tags from source text, replacing them with
 * placeholders. Must run BEFORE tokenizeMath() so LaTeX in props is preserved.
 */
export function tokenizeInteractiveComponents(source: string): {
  cleaned: string;
  slots: ComponentSlot[];
} {
  const slots: ComponentSlot[] = [];

  const cleaned = source.replace(TAG_REGEX, (_match, type: ComponentType, propsRaw?: string) => {
    const props = propsRaw ? parseProps(propsRaw.trim()) : {};
    const slot: ComponentSlot = {
      index: slots.length,
      type,
      answer: typeof props.answer === "string" ? props.answer : "",
    };

    if (type === "MultipleChoice" && Array.isArray(props.options)) {
      slot.options = props.options;
    }

    if (type === "FreeResponse" && typeof props.prompt === "string") {
      slot.prompt = props.prompt;
    }

    slots.push(slot);
    return compPlaceholder(slot.index);
  });

  return { cleaned, slots };
}

/** Quick check — does this text contain any interactive tags? */
export function hasInteractiveTags(text: string): boolean {
  return /<(FillInBlank|MultipleChoice|FreeResponse)\s/.test(text);
}
