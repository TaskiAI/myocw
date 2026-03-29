import argparse
import re
import zipfile
import urllib.request
import io
from pathlib import Path

import fitz  # pymupdf
from PIL import Image
from mlx_vlm import load, generate
from mlx_vlm.prompt_utils import apply_chat_template
from mlx_vlm.utils import load_config

# --- Constants ---

MODEL_ID = "mlx-community/MinerU2.5-2509-1.2B-bf16"
WORK_DIR = Path("/tmp/ocw_ingestion")

SOL_PATTERN = re.compile(r"sol|solution|ans", re.IGNORECASE)
TRANSCRIPT_PATTERN = re.compile(r"_[a-zA-Z0-9_-]{11}\.pdf$")

PAGE_TO_MARKDOWN_PROMPT = (
    "Convert this document page to markdown. "
    "Preserve all math using LaTeX: $...$ inline, $$...$$ display. "
    "Reproduce all text exactly."
)


def pdf_to_images(pdf_path: str, dpi: int = 150) -> list:
    doc = fitz.open(pdf_path)
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    images = []
    for page in doc:
        pix = page.get_pixmap(matrix=mat)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        images.append(img)
    doc.close()
    return images


def main():
    parser = argparse.ArgumentParser(description="Stage 1: PDF → Markdown via MinerU")
    parser.add_argument("slug", help="Course slug (e.g. 18-06sc-linear-algebra-fall-2011)")
    parser.add_argument("--include-solutions", action="store_true", default=False,
                        help="Include solution PDFs (excluded by default)")
    args = parser.parse_args()

    course_slug = args.slug
    base_url = f"https://ocw.mit.edu/courses/{course_slug}/"
    extract_dir = WORK_DIR / course_slug
    output_dir = WORK_DIR / "markdown" / course_slug

    # --- Step 1: Download & extract course zip ---

    WORK_DIR.mkdir(parents=True, exist_ok=True)

    if extract_dir.exists():
        print(f"Already extracted: {extract_dir}")
    else:
        download_page_url = base_url + "download"
        print(f"Fetching {download_page_url}")
        with urllib.request.urlopen(download_page_url) as resp:
            html = resp.read().decode("utf-8")

        match = re.search(r'href="([^"]+\.zip)"', html)
        if not match:
            raise RuntimeError("No .zip link found on download page")
        zip_href = match.group(1)
        if not zip_href.startswith("http"):
            zip_href = "https://ocw.mit.edu" + zip_href
        print(f"Zip URL: {zip_href}")

        zip_path = WORK_DIR / f"{course_slug}.zip"
        print(f"Downloading to {zip_path} ...")
        urllib.request.urlretrieve(zip_href, zip_path)
        print(f"Downloaded ({zip_path.stat().st_size / 1e6:.1f} MB)")

        print("Extracting ...")
        extract_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(extract_dir)
        print(f"Extracted to {extract_dir}")

    # --- Step 2: Find PDFs ---

    static_resources = extract_dir / "static_resources"
    all_pdfs = sorted(static_resources.glob("*.pdf"))

    # Exclude transcripts (hash_YouTubeID.pdf pattern) and solutions by default
    target_pdfs = [p for p in all_pdfs if not TRANSCRIPT_PATTERN.search(p.name)]
    if not args.include_solutions:
        target_pdfs = [p for p in target_pdfs if not SOL_PATTERN.search(p.name)]

    print(f"Total PDFs: {len(all_pdfs)}, Target PDFs: {len(target_pdfs)}")
    for p in target_pdfs:
        print(f"  {p.name}")

    if not target_pdfs:
        raise RuntimeError("No target PDFs found — check static_resources/")

    # --- Step 3: Load MinerU model ---

    print(f"Loading {MODEL_ID}...")
    model, processor = load(MODEL_ID)
    config = load_config(MODEL_ID)
    print("Model loaded.")

    # --- Step 4: PDF pages → normalized markdown ---

    output_dir.mkdir(parents=True, exist_ok=True)

    for pdf_path in target_pdfs:
        out_path = output_dir / f"{pdf_path.stem}.md"
        if out_path.exists():
            print(f"Already done: {out_path.name}")
            continue

        print(f"\nProcessing {pdf_path.name}...")
        pages = pdf_to_images(str(pdf_path))
        print(f"  {len(pages)} page(s)")

        page_markdowns = []
        for i, page_img in enumerate(pages):
            formatted_prompt = apply_chat_template(
                processor, config, PAGE_TO_MARKDOWN_PROMPT, num_images=1
            )
            page_md = generate(model, processor, formatted_prompt, [page_img], max_tokens=2048).text
            page_markdowns.append(page_md)
            print(f"  Page {i + 1}: {len(page_md)} chars")

        combined = "\n\n---\n\n".join(page_markdowns)

        # Normalize math delimiters: \(...\) → $...$ and \[...\] → $$...$$
        combined = re.sub(r"\\\((.+?)\\\)", r"$\1$", combined, flags=re.DOTALL)
        combined = re.sub(r"\\\[(.+?)\\\]", r"$$\1$$", combined, flags=re.DOTALL)

        out_path.write_text(combined)
        print(f"  Saved → {out_path}")

    print(f"\nDone. Markdown files in {output_dir}")


if __name__ == "__main__":
    main()
