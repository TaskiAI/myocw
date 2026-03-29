import {
  QWEN_ENDPOINT_URL,
  QWEN_CHAT_COMPLETIONS_URL,
  QWEN_MODEL,
  QWEN_MAX_OUTPUT_TOKENS,
  QWEN_REQUEST_TIMEOUT_MS,
  QWEN_API_KEY,
  OPENAI_API_KEY,
  OPENAI_ENDPOINT_URL,
  OPENAI_FILES_URL,
  OPENAI_MODEL,
  OPENAI_MAX_OUTPUT_TOKENS,
  OPENAI_REASONING_EFFORT,
  OPENAI_TEXT_VERBOSITY,
  PARSER_PROVIDER,
} from "./config.js";
import type {
  QwenCallResult,
  QwenChatResponse,
  QwenInputContent,
  QwenResponse,
  QwenUsage,
  OpenAiResponseOptions,
} from "./types.js";

export function extractOutputText(payload: QwenResponse): string {
  const text = (payload.output ?? [])
    .filter((entry) => entry.type === "message")
    .flatMap((entry) => entry.content ?? [])
    .filter((chunk) => chunk.type === "output_text")
    .map((chunk) => chunk.text ?? "")
    .join("");

  return text.trim();
}

export function extractReasoningText(payload: QwenResponse): string {
  const text = (payload.output ?? [])
    .filter((entry) => entry.type === "reasoning")
    .flatMap((entry) => entry.content ?? [])
    .filter((chunk) => chunk.type === "reasoning_text")
    .map((chunk) => chunk.text ?? "")
    .join("");

  return text.trim();
}

export function normalizeChatUsage(
  usage: QwenChatResponse["usage"] | undefined,
): QwenUsage | null {
  if (!usage) return null;
  return {
    input_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  };
}

export function logUsage(prefix: string, usage: QwenUsage | null): void {
  if (!usage) return;
  console.log(
    `${prefix} usage input=${usage.input_tokens ?? "?"} output=${usage.output_tokens ?? "?"} total=${usage.total_tokens ?? "?"}`,
  );
}

export async function sendQwenRequest(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QWEN_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function toChatContent(input: QwenInputContent[]): Array<Record<string, unknown>> {
  return input.map((item) => {
    if (item.type === "input_text") {
      return { type: "text", text: item.text };
    }
    if (item.type === "input_file") {
      return {
        type: "text",
        text: "[input_file omitted in chat/completions fallback]",
      };
    }
    return {
      type: "image_url",
      image_url: { url: item.image_url },
    };
  });
}

export function extractChatOutputText(payload: QwenChatResponse): string {
  const first = payload.choices?.[0]?.message?.content;
  if (typeof first === "string") return first.trim();
  if (Array.isArray(first)) {
    return first
      .map((chunk) => (typeof chunk.text === "string" ? chunk.text : ""))
      .join("")
      .trim();
  }
  return "";
}

export async function callQwenChatCompletions(
  input: string | QwenInputContent[],
  headers: Record<string, string>,
): Promise<QwenCallResult> {
  const body: Record<string, unknown> = {
    model: QWEN_MODEL,
    temperature: 0,
    max_tokens: QWEN_MAX_OUTPUT_TOKENS,
    messages: [
      {
        role: "user",
        content:
          typeof input === "string"
            ? input
            : toChatContent(input),
      },
    ],
  };

  const response = await sendQwenRequest(QWEN_CHAT_COMPLETIONS_URL, body, headers);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qwen chat fallback error (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as QwenChatResponse;
  const outputText = extractChatOutputText(payload);
  if (!outputText) {
    throw new Error("Qwen chat fallback returned no assistant text output");
  }

  return {
    outputText,
    usage: normalizeChatUsage(payload.usage),
  };
}

export async function callQwenResponses(
  input: string | QwenInputContent[],
): Promise<QwenCallResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (QWEN_API_KEY) {
    headers.Authorization = `Bearer ${QWEN_API_KEY}`;
  }

  const body: Record<string, unknown> = {
    model: QWEN_MODEL,
    temperature: 0,
    max_output_tokens: QWEN_MAX_OUTPUT_TOKENS,
    input:
      typeof input === "string"
        ? input
        : [
            {
              type: "message",
              role: "user",
              content: input,
            },
          ],
  };

  const response = await sendQwenRequest(QWEN_ENDPOINT_URL, body, headers);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qwen endpoint error (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as QwenResponse;
  const outputText = extractOutputText(payload);
  if (outputText) {
    if (
      Array.isArray(input) &&
      (payload.usage?.output_tokens ?? 0) >= QWEN_MAX_OUTPUT_TOKENS - 2
    ) {
      console.log(
        "  Responses output hit max token budget; retrying via chat/completions fallback...",
      );
      return await callQwenChatCompletions(input, headers);
    }

    return {
      outputText,
      usage: payload.usage ?? null,
    };
  }

  const reasoningText = extractReasoningText(payload);
  if (
    reasoningText &&
    (/^\s*[\[{]/.test(reasoningText) ||
      reasoningText.includes("```json") ||
      reasoningText.includes("\"problem_label\""))
  ) {
    return {
      outputText: reasoningText,
      usage: payload.usage ?? null,
    };
  }

  console.log(
    "  Responses API returned no assistant output_text; trying chat/completions fallback...",
  );
  return await callQwenChatCompletions(input, headers);
}

export async function uploadPdfToOpenAI(pdfBuffer: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append("purpose", "user_data");
  const bytes = new Uint8Array(pdfBuffer);
  form.append("file", new Blob([bytes], { type: "application/pdf" }), filename);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QWEN_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(OPENAI_FILES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI file upload failed (${response.status}): ${text}`);
    }
    const payload = (await response.json()) as { id?: string };
    if (!payload.id) {
      throw new Error("OpenAI file upload returned no file id");
    }
    return payload.id;
  } finally {
    clearTimeout(timeout);
  }
}

export function getOpenAiModelFallback(primaryModel: string): string | null {
  const normalized = primaryModel.trim();
  if (normalized === "gpt-5.1-nano") return "gpt-5-nano";
  return null;
}

export function isOpenAiModelNotFound(status: number, responseText: string): boolean {
  if (status !== 400) return false;
  if (responseText.includes("\"model_not_found\"")) return true;
  return /requested model .* does not exist/i.test(responseText);
}

export async function callOpenAiResponses(
  input: string | QwenInputContent[],
  options: OpenAiResponseOptions = {},
): Promise<QwenCallResult> {
  const modelCandidates = [OPENAI_MODEL];
  const fallbackModel = getOpenAiModelFallback(OPENAI_MODEL);
  if (fallbackModel && fallbackModel !== OPENAI_MODEL) {
    modelCandidates.push(fallbackModel);
  }

  let lastError: Error | null = null;

  for (let i = 0; i < modelCandidates.length; i++) {
    const model = modelCandidates[i];
    const textConfig: Record<string, unknown> = {
      verbosity: OPENAI_TEXT_VERBOSITY,
    };
    if (options.jsonSchema) {
      textConfig.format = {
        type: "json_schema",
        name: options.jsonSchema.name,
        schema: options.jsonSchema.schema,
        strict: true,
      };
    }

    const body: Record<string, unknown> = {
      model,
      max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
      reasoning: { effort: OPENAI_REASONING_EFFORT },
      text: textConfig,
      input:
        typeof input === "string"
          ? input
          : [
              {
                type: "message",
                role: "user",
                content: input,
              },
            ],
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), QWEN_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(OPENAI_ENDPOINT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        if (
          i < modelCandidates.length - 1 &&
          isOpenAiModelNotFound(response.status, text)
        ) {
          console.warn(
            `  OpenAI model '${model}' unavailable; retrying with '${modelCandidates[i + 1]}'`,
          );
          continue;
        }
        throw new Error(`OpenAI responses error (${response.status}): ${text}`);
      }
      const payload = (await response.json()) as QwenResponse;
      const outputText = extractOutputText(payload);
      if (!outputText) {
        throw new Error("OpenAI responses returned no assistant output_text");
      }
      return {
        outputText,
        usage: payload.usage ?? null,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (i >= modelCandidates.length - 1) {
        throw lastError;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("OpenAI responses call failed");
}

export async function callOpenAiResponsesWithPdf(
  prompt: string,
  fileId: string,
  options: OpenAiResponseOptions = {},
): Promise<QwenCallResult> {
  return await callOpenAiResponses([
    { type: "input_text", text: prompt },
    { type: "input_file", file_id: fileId },
  ], options);
}

export async function callRepairModel(
  prompt: string,
  options: OpenAiResponseOptions = {},
): Promise<QwenCallResult> {
  if (PARSER_PROVIDER !== "openai_pdf") {
    return await callQwenResponses(prompt);
  }
  return await callOpenAiResponses(prompt, options);
}

export async function parseWithRepair<T>(
  rawOutput: string,
  parser: (text: string) => T | null,
  schemaHint: string,
  contextLabel: string,
  repairOptions: OpenAiResponseOptions = {},
): Promise<T> {
  const firstAttempt = parser(rawOutput);
  if (firstAttempt !== null) {
    return firstAttempt;
  }

  console.log(`  ${contextLabel}: invalid JSON, requesting one repair pass...`);
  const repairPrompt = `Fix this into valid JSON only.

Required schema:
${schemaHint}

Rules:
- Output ONLY valid JSON.
- No markdown fences.
- Do not add commentary.

Broken JSON / model output:
${rawOutput}`;

  const repairedCall = await callRepairModel(repairPrompt, repairOptions);
  logUsage("  JSON repair", repairedCall.usage);

  const repaired = parser(repairedCall.outputText);
  if (repaired !== null) {
    return repaired;
  }

  throw new Error(`${contextLabel}: model output was not valid JSON after repair`);
}
