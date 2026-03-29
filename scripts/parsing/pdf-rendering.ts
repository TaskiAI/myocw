import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SUPABASE_PUBLIC_URL,
  STORAGE_BUCKET,
  PDF_RENDERER_PROJECT,
  PDF_RENDERER_SCRIPT,
  QWEN_IMAGE_DPI,
  QWEN_IMAGE_FORMAT,
  QWEN_IMAGE_QUALITY,
  QWEN_RENDER_MAX_PAGES,
} from "./config.js";
import { sanitizeFilename } from "./json-utils.js";
import type {
  CommandResult,
  RenderManifest,
  RenderedPageImage,
  RenderedPdf,
} from "./types.js";

export function resolveStorageUrl(pdfPath: string): string {
  if (pdfPath.startsWith("http")) return pdfPath;
  const cleaned = pdfPath.replace(/^\//, "");
  const objectPath = cleaned.startsWith("content/")
    ? cleaned.replace(/^content\//, "")
    : cleaned;
  return `${SUPABASE_PUBLIC_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}`;
}

export async function downloadPdf(pdfPath: string): Promise<Buffer> {
  const url = resolveStorageUrl(pdfPath);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download PDF (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function runCommand(cmd: string, args: string[]): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
      });
    });
  });
}

export async function cleanupRenderedPdf(rendered: RenderedPdf | null): Promise<void> {
  if (!rendered) return;
  await rm(rendered.tempDir, { recursive: true, force: true });
}

export async function renderPdfToImages(
  pdfBuffer: Buffer,
  filenameHint: string,
): Promise<RenderedPdf> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "myocw-render-"));
  const pdfPath = path.join(tempDir, `${sanitizeFilename(filenameHint) || "input"}.pdf`);
  const outputDir = path.join(tempDir, "images");

  await writeFile(pdfPath, pdfBuffer);

  const args = [
    "run",
    "--project",
    PDF_RENDERER_PROJECT,
    "python",
    PDF_RENDERER_SCRIPT,
    "--input-pdf",
    pdfPath,
    "--output-dir",
    outputDir,
    "--dpi",
    String(QWEN_IMAGE_DPI),
    "--format",
    QWEN_IMAGE_FORMAT,
    "--quality",
    String(QWEN_IMAGE_QUALITY),
  ];

  if (QWEN_RENDER_MAX_PAGES > 0) {
    args.push("--max-pages", String(QWEN_RENDER_MAX_PAGES));
  }

  const result = await runCommand("uv", args);
  if (result.exitCode !== 0) {
    await rm(tempDir, { recursive: true, force: true });
    throw new Error(
      `PDF rendering failed (exit=${result.exitCode}): ${result.stderr.trim() || result.stdout.trim() || "unknown error"}`,
    );
  }

  let manifest: RenderManifest;
  try {
    manifest = JSON.parse(result.stdout.trim()) as RenderManifest;
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw new Error(
      `PDF renderer returned invalid JSON manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(manifest.pages)) {
    await rm(tempDir, { recursive: true, force: true });
    throw new Error("PDF renderer manifest missing pages array");
  }

  const pages: RenderedPageImage[] = [];
  let totalImageBytes = 0;

  for (const page of manifest.pages) {
    const imagePath = path.isAbsolute(page.image_path)
      ? page.image_path
      : path.resolve(outputDir, page.image_path);

    const imageBytes = await readFile(imagePath);
    totalImageBytes += imageBytes.length;

    const mime = page.mime || (QWEN_IMAGE_FORMAT === "png" ? "image/png" : "image/jpeg");

    pages.push({
      page_index: page.page_index,
      image_path: imagePath,
      mime,
      width: page.width,
      height: page.height,
      data_url: `data:${mime};base64,${imageBytes.toString("base64")}`,
      bytes: imageBytes.length,
    });
  }

  return {
    tempDir,
    sourcePageCount:
      typeof manifest.page_count === "number" ? Math.max(0, Math.trunc(manifest.page_count)) : pages.length,
    renderedCount:
      typeof manifest.rendered_count === "number"
        ? Math.max(0, Math.trunc(manifest.rendered_count))
        : pages.length,
    truncated: Boolean(manifest.truncated),
    totalImageBytes,
    pages,
  };
}
