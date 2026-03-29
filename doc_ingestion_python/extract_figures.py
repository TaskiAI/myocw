"""Extract embedded images from a PDF in reading order. Outputs JSON to stdout.

Usage: python extract_figures.py <pdf_url_or_path>

Output: JSON array of objects:
  [{"index": 0, "ext": "png", "base64": "...", "width": 400, "height": 300}, ...]
"""

import sys
import json
import base64
import io
import fitz  # pymupdf


MIN_WIDTH = 100
MIN_HEIGHT = 100
MIN_BYTES = 2048


def extract_figures(pdf_bytes: bytes) -> list[dict]:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    seen_xrefs: set[int] = set()
    figures: list[dict] = []
    idx = 0

    for page in doc:
        for img_info in page.get_images(full=True):
            xref = img_info[0]
            if xref in seen_xrefs:
                continue
            seen_xrefs.add(xref)

            try:
                extracted = doc.extract_image(xref)
            except Exception:
                continue

            if not extracted or not extracted.get("image"):
                continue

            img_bytes = extracted["image"]
            width = extracted.get("width", 0)
            height = extracted.get("height", 0)
            ext = extracted.get("ext", "png")

            # Filter noise: small icons, decorations, spacers
            if width < MIN_WIDTH or height < MIN_HEIGHT:
                continue
            if len(img_bytes) < MIN_BYTES:
                continue

            figures.append({
                "index": idx,
                "ext": ext,
                "base64": base64.b64encode(img_bytes).decode("ascii"),
                "width": width,
                "height": height,
            })
            idx += 1

    doc.close()
    return figures


def main():
    if len(sys.argv) < 2:
        print("Usage: python extract_figures.py <pdf_url_or_path>", file=sys.stderr)
        sys.exit(1)

    source = sys.argv[1]

    # URL or local file
    if source.startswith("http://") or source.startswith("https://"):
        import urllib.request
        with urllib.request.urlopen(source) as resp:
            pdf_bytes = resp.read()
    else:
        with open(source, "rb") as f:
            pdf_bytes = f.read()

    figures = extract_figures(pdf_bytes)
    json.dump(figures, sys.stdout)


if __name__ == "__main__":
    main()
