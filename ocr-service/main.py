"""Phase 1 — OCR service.

Receives a PDF, renders each page to an image with pdfium and runs
PaddleOCR (French model) on it. Returns the recognised text lines in
reading order (top-to-bottom, left-to-right).
"""

import hmac
import logging
import os
import threading
from pathlib import Path

import pypdfium2 as pdfium
import numpy as np
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from paddleocr import PaddleOCR

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ocr-service")

MAX_PDF_BYTES = int(os.getenv("MAX_PDF_MB", "10")) * 1024 * 1024
MAX_REQUEST_BYTES = MAX_PDF_BYTES + 64 * 1024  # room for the multipart envelope
MAX_PAGES = int(os.getenv("MAX_PAGES", "5"))
RENDER_DPI = int(os.getenv("RENDER_DPI", "200"))
MIN_SCORE = float(os.getenv("MIN_SCORE", "0.5"))
WEB_ENV_FILE = Path(__file__).resolve().parent.parent / "web" / ".env.local"


def load_token() -> str:
    """The shared secret: from the environment, otherwise from the web app's .env.local."""
    token = os.getenv("OCR_SERVICE_TOKEN", "").strip()
    if not token and WEB_ENV_FILE.is_file():
        for line in WEB_ENV_FILE.read_text(encoding="utf-8").splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() == "OCR_SERVICE_TOKEN":
                token = value.strip().strip("\"'")
    if not token or token == "change-me":
        raise RuntimeError("OCR_SERVICE_TOKEN is not set (see web/.env.example).")
    return token


OCR_TOKEN = load_token()

app = FastAPI(title="Bank transfer OCR service", docs_url=None, redoc_url=None, openapi_url=None)


# HTTP middleware rather than a FastAPI dependency: dependencies run after the upload is parsed.
@app.middleware("http")
async def require_token(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    supplied = request.headers.get("x-ocr-token", "")
    if not hmac.compare_digest(supplied.encode(), OCR_TOKEN.encode()):
        return JSONResponse({"detail": "Unauthorized."}, status_code=401)
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > MAX_REQUEST_BYTES:
        return JSONResponse({"detail": "PDF is too large."}, status_code=413)
    return await call_next(request)


log.info("Loading PaddleOCR (lang=fr)... first run downloads the models.")
ocr = PaddleOCR(
    lang="fr",
    # Photos / scans are often rotated (0/90/180/270°): detect and fix page rotation,
    # then fix individual upside-down text lines.
    use_doc_orientation_classify=True,
    use_doc_unwarping=False,
    use_textline_orientation=True,
)
# PaddleOCR pipelines are not thread-safe; serialise inference.
ocr_lock = threading.Lock()
log.info("PaddleOCR ready.")


def render_pages(pdf_bytes: bytes) -> list[np.ndarray]:
    try:
        doc = pdfium.PdfDocument(pdf_bytes)
    except Exception as exc:  # corrupted / not a PDF
        raise HTTPException(status_code=400, detail="Invalid PDF file.") from exc

    try:
        n = len(doc)
        if n == 0:
            raise HTTPException(status_code=400, detail="The PDF has no pages.")
        if n > MAX_PAGES:
            raise HTTPException(status_code=400, detail=f"The PDF has {n} pages (max {MAX_PAGES}).")

        images = []
        for i in range(n):
            pil = doc[i].render(scale=RENDER_DPI / 72).to_pil().convert("RGB")
            images.append(np.asarray(pil)[:, :, ::-1].copy())  # RGB -> BGR (PaddleOCR expects BGR)
        return images
    finally:
        doc.close()


def to_lines(result, page_index: int) -> list[dict]:
    """Convert one PaddleOCR 3.x result into sorted line dicts."""
    texts = result["rec_texts"]
    scores = result["rec_scores"]
    polys = result["rec_polys"]

    items = []
    for text, score, poly in zip(texts, scores, polys):
        text = str(text).strip()
        if not text or float(score) < MIN_SCORE:
            continue
        pts = np.asarray(poly)
        items.append(
            {
                "text": text,
                "score": round(float(score), 4),
                "page": page_index + 1,
                "x": float(pts[:, 0].min()),
                "y": float(pts[:, 1].min()),
                "h": float(pts[:, 1].max() - pts[:, 1].min()),
            }
        )

    # Reading order: group boxes into rows (similar y), then left-to-right.
    items.sort(key=lambda it: (it["y"], it["x"]))
    rows: list[list[dict]] = []
    for it in items:
        if rows and abs(rows[-1][0]["y"] - it["y"]) < 0.5 * max(it["h"], 1):
            rows[-1].append(it)
        else:
            rows.append([it])
    ordered = []
    for row in rows:
        ordered.extend(sorted(row, key=lambda it: it["x"]))
    return [{"text": it["text"], "score": it["score"], "page": it["page"]} for it in ordered]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/ocr")
async def run_ocr(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF is too large.")
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="The file is not a PDF.")

    pages = render_pages(data)
    lines: list[dict] = []
    with ocr_lock:
        for i, img in enumerate(pages):
            for res in ocr.predict(img):
                lines.extend(to_lines(res, i))

    log.info("OCR done: %d page(s), %d line(s)", len(pages), len(lines))
    return {"pages": len(pages), "lines": lines}
