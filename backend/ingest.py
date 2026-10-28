
from pathlib import Path

import chromadb
import fitz  # PyMuPDF
from sentence_transformers import SentenceTransformer


# Project paths
BACKEND_DIR = Path(__file__).resolve().parent
DATA_DIR = BACKEND_DIR / "data"
VECTOR_DB_DIR = BACKEND_DIR / "vector_db"

# Embedding model
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150
BATCH_SIZE = 100


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
    model = SentenceTransformer(MODEL_NAME)

    all_chunks = []
    all_metadata = []
    all_ids = []

    # Extract text and create chunks
    for pdf_path in pdf_files:
        print(f"Reading: {pdf_path.name}")

        try:
            with fitz.open(pdf_path) as pdf:
                for page_number, page in enumerate(pdf, start=1):
                    text = page.get_text("text")
                    chunks = split_text(text)

                    for chunk_number, chunk in enumerate(chunks, start=1):
                        all_chunks.append(chunk)

                        all_metadata.append({
                            "source": pdf_path.name,
                            "page": page_number,
                            "chunk": chunk_number,
                        })

                        all_ids.append(
                            f"{pdf_path.stem}-p{page_number}-c{chunk_number}"
                        )

        except Exception as error:
            print(f"Could not read {pdf_path.name}: {error}")

    if not all_chunks:
        print("No readable text found in the PDFs.")
        print("If they are scanned PDFs, OCR may be required.")
        return

    print(f"Created {len(all_chunks)} text chunks.")

    # Generate embeddings and store them in ChromaDB
    VECTOR_DB_DIR.mkdir(parents=True, exist_ok=True)

    client = chromadb.PersistentClient(
        path=str(VECTOR_DB_DIR)
    )

    # Rebuild this collection to avoid duplicate records
    try:
        client.delete_collection("university_docs")
    except Exception:
        pass

    collection = client.create_collection(
        name="university_docs",
        metadata={"hnsw:space": "cosine"},
    )

    for start in range(0, len(all_chunks), BATCH_SIZE):
        end = start + BATCH_SIZE

        batch_texts = all_chunks[start:end]
        batch_metadata = all_metadata[start:end]
        batch_ids = all_ids[start:end]

        embeddings = model.encode(
            batch_texts,
            show_progress_bar=False,
        ).tolist()

        collection.add(
            ids=batch_ids,
            documents=batch_texts,
            metadatas=batch_metadata,
            embeddings=embeddings,
        )

        print(f"Stored {min(end, len(all_chunks))}/{len(all_chunks)} chunks.")

    print("\nIngestion completed successfully!")
    print(f"PDF files processed: {len(pdf_files)}")
    print(f"Total chunks stored: {collection.count()}")
    print(f"Vector database: {VECTOR_DB_DIR}")


if __name__ == "__main__":
    main()
