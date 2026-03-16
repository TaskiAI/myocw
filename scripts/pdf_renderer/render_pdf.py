#!/usr/bin/env python3
import argparse
import json
import os
import sys
from pathlib import Path

import pypdfium2 as pdfium


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Render a PDF into per-page images.")
    parser.add_argument("--input-pdf", required=True, help="Absolute path to input PDF")
    parser.add_argument("--output-dir", required=True, help="Directory to write rendered images")
    parser.add_argument("--dpi", type=int, default=170, help="Render DPI (default: 170)")
    parser.add_argument(
        "--format",
        default="jpeg",
        choices=["jpeg", "jpg", "png"],
        help="Image format (jpeg/png)",
    )
    parser.add_argument("--quality", type=int, default=88, help="JPEG quality (1-100)")
    parser.add_argument(
        "--max-pages",
        type=int,
        default=0,
        help="Max pages to render; 0 means all pages",
    )
    return parser


def to_mime(fmt: str) -> str:
    if fmt in ("jpeg", "jpg"):
        return "image/jpeg"
    return "image/png"


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    input_pdf = Path(args.input_pdf).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    if not input_pdf.exists():
        print(f"Input PDF does not exist: {input_pdf}", file=sys.stderr)
        return 1

    if args.dpi <= 0:
        print("--dpi must be > 0", file=sys.stderr)
        return 1

    if args.quality <= 0 or args.quality > 100:
        print("--quality must be between 1 and 100", file=sys.stderr)
        return 1

    image_format = "jpeg" if args.format == "jpg" else args.format
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        pdf = pdfium.PdfDocument(str(input_pdf))
        page_count = len(pdf)
        scale = args.dpi / 72.0
        max_pages = page_count if args.max_pages <= 0 else min(page_count, args.max_pages)

        pages = []
        ext = "jpg" if image_format == "jpeg" else "png"
        mime = to_mime(image_format)

        for idx in range(max_pages):
            page = pdf[idx]
            pil_image = page.render(scale=scale).to_pil()
            image_name = f"page-{idx + 1:04d}.{ext}"
            image_path = output_dir / image_name

            if image_format == "jpeg":
                pil_image = pil_image.convert("RGB")
                pil_image.save(
                    image_path,
                    format="JPEG",
                    quality=args.quality,
                    optimize=True,
                )
            else:
                pil_image.save(image_path, format="PNG")

            pages.append(
                {
                    "page_index": idx,
                    "image_path": str(image_path),
                    "mime": mime,
                    "width": pil_image.width,
                    "height": pil_image.height,
                }
            )

        manifest = {
            "input_pdf": str(input_pdf),
            "page_count": page_count,
            "rendered_count": len(pages),
            "truncated": len(pages) < page_count,
            "dpi": args.dpi,
            "format": image_format,
            "quality": args.quality,
            "pages": pages,
        }

        sys.stdout.write(json.dumps(manifest))
        return 0
    except Exception as exc:  # pragma: no cover
        print(f"render_pdf failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
