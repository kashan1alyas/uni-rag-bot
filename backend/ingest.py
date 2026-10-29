
from pathlib import Path

import chromadb
import pymupdf
import pytesseract
from PIL import Image
from sentence_transformers import SentenceTransformer


# Project paths
BACKEND_DIR = Path(__file__).resolve().parent
DATA_DIR = BACKEND_DIR / "data"
VECTOR_DB_DIR = BACKEND_DIR / "vector_db"

# Tesseract installation path on Windows
pytesseract.pytesseract.tesseract_cmd = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

# Embedding model
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150
BATCH_SIZE = 100

# Use OCR if a page contains fewer than this many characters
MIN_TEXT_LENGTH = 40



def extract_page_text(page):
    """Extract PDF text and use OCR when the page contains images."""

    text = page.get_text("text", sort=True).strip()
    has_images = bool(page.get_images(full=True))

    # Use normal PDF text when the page has no images
    # and contains enough readable text.
    if len(text) >= MIN_TEXT_LENGTH and not has_images:
        return text, "pdf_text"

    print("  Trying OCR to capture slide content...")

    try:
        # Render at higher resolution for better OCR accuracy.
        pix = page.get_pixmap(
            matrix=pymupdf.Matrix(3, 3),
            alpha=False,
        )

        image = Image.frombytes(
            "RGB",
            [pix.width, pix.height],
            pix.samples,
        )

        # PSM 6 works better for many lecture slides.
        ocr_text = pytesseract.image_to_string(
            image,
            config="--psm 6",
        ).strip()

        # Keep OCR when it provides more text than PDF extraction.
        if len(ocr_text) > len(text):
            return ocr_text, "ocr_psm6"

    except Exception as error:
        print(f"  OCR failed: {error}")

    return text, "pdf_text"


def split_text(text):
    """Split text into overlapping character chunks."""
    text = " ".join(text.split())

    if not text:
        return []

    chunks = []
    start = 0

    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        chunk = text[start:end].strip()

        if chunk:
            chunks.append(chunk)

        if end == len(text):
            break

        start = end - CHUNK_OVERLAP

    return chunks


def main():
    pdf_files = sorted(DATA_DIR.glob("*.pdf"))

    if not pdf_files:
        print(f"No PDF files found in: {DATA_DIR}")
        return

    print(f"Found {len(pdf_files)} PDF file(s).")

    print("Loading embedding model...")
    model = SentenceTransformer(
        MODEL_NAME,
        local_files_only=True,
    )

    all_chunks = []
    all_metadata = []
    all_ids = []

    # Extract text from every page
    for pdf_path in pdf_files:
        print(f"\nReading: {pdf_path.name}")

        try:
            with pymupdf.open(pdf_path) as pdf:
                for page_number, page in enumerate(pdf, start=1):
                    text, method = extract_page_text(page)
                    chunks = split_text(text)

                    if chunks:
                        print(
                            f"  Page {page_number}: "
                            f"{len(chunks)} chunk(s), method={method}"
                        )

                    for chunk_number, chunk in enumerate(
                        chunks, start=1
                    ):
                        all_chunks.append(chunk)

                        all_metadata.append({
                            "source": pdf_path.name,
                            "page": page_number,
                            "chunk": chunk_number,
                            "method": method,
                        })

                        all_ids.append(
                            f"{pdf_path.stem}-p{page_number}-c{chunk_number}"
                        )

        except Exception as error:
            print(f"Could not read {pdf_path.name}: {error}")

    if not all_chunks:
        print("No readable text found in the PDFs.")
        return

    print(f"\nCreated {len(all_chunks)} text chunks.")

    # Prepare the vector database
    VECTOR_DB_DIR.mkdir(parents=True, exist_ok=True)

    client = chromadb.PersistentClient(
        path=str(VECTOR_DB_DIR)
    )

    # WARNING: This replaces the existing university_docs collection.
    try:
        client.delete_collection("university_docs")
    except Exception:
        pass

    collection = client.create_collection(
        name="university_docs",
        metadata={"hnsw:space": "cosine"},
    )

    # Embed and store chunks in batches
    for start in range(0, len(all_chunks), BATCH_SIZE):
        end = start + BATCH_SIZE

        batch_texts = all_chunks[start:end]
        batch_metadata = all_metadata[start:end]
        batch_ids = all_ids[start:end]

        embeddings = model.encode(
            batch_texts,
            show_progress_bar=False,
            normalize_embeddings=True,
        ).tolist()

        collection.add(
            ids=batch_ids,
            documents=batch_texts,
            metadatas=batch_metadata,
            embeddings=embeddings,
        )

        print(
            f"Stored {min(end, len(all_chunks))}"
            f"/{len(all_chunks)} chunks."
        )

    print("\nIngestion completed successfully!")
    print(f"PDF files processed: {len(pdf_files)}")
    print(f"Total chunks stored: {collection.count()}")
    print(f"Vector database: {VECTOR_DB_DIR}")


if __name__ == "__main__":
    main()
