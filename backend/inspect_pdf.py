
from pathlib import Path

import pymupdf
import pytesseract
from PIL import Image

pytesseract.pytesseract.tesseract_cmd = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

pdf_path = (
    Path(__file__).resolve().parent
    / "data"
    / "Lect-05Linear Regression.pdf"
)

with pymupdf.open(pdf_path) as pdf:
    page = pdf[33]  # PDF page 34

    print("NORMAL PDF TEXT:")
    print(page.get_text("text", sort=True))

    pix = page.get_pixmap(
        matrix=pymupdf.Matrix(3, 3),
        alpha=False,
    )

    image = Image.frombytes(
        "RGB",
        [pix.width, pix.height],
        pix.samples,
    )

    print("\nOCR WITH DEFAULT SETTINGS:")
    print(pytesseract.image_to_string(image))

    print("\nOCR WITH PAGE SEGMENTATION MODE 6:")
    print(
        pytesseract.image_to_string(
            image,
            config="--psm 6",
        )
    )

    print("\nOCR WITH PAGE SEGMENTATION MODE 11:")
    print(
        pytesseract.image_to_string(
            image,
            config="--psm 11",
        )
    )
