
from functools import lru_cache
from pathlib import Path

import chromadb
from sentence_transformers import SentenceTransformer


# Project paths and model
BACKEND_DIR = Path(__file__).resolve().parent
VECTOR_DB_DIR = BACKEND_DIR / "vector_db"
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"


@lru_cache(maxsize=1)
def get_model():
    """Load the embedding model once and reuse it."""
    print("Loading embedding model...")

    return SentenceTransformer(
        MODEL_NAME,
        local_files_only=True,
    )


@lru_cache(maxsize=1)
def get_collection():
    """Connect to the existing university vector database."""
    client = chromadb.PersistentClient(
        path=str(VECTOR_DB_DIR)
    )

    return client.get_collection("university_docs")


def retrieve_documents(question: str, top_k: int = 5):
    """Retrieve relevant passages from university PDFs."""

    if not question or not question.strip():
        return []

    if top_k < 1:
        return []

    collection = get_collection()
    total_chunks = collection.count()

    if total_chunks == 0:
        return []

    model = get_model()

    question_embedding = model.encode(
        question.strip(),
        normalize_embeddings=True,
    ).tolist()

    results = collection.query(
        query_embeddings=[question_embedding],
        n_results=min(top_k, total_chunks),
        include=[
            "documents",
            "metadatas",
            "distances",
        ],
    )

    passages = []
    seen = set()

    for i, document in enumerate(results["documents"][0]):
        metadata = results["metadatas"][0][i] or {}

        # Avoid returning identical text more than once.
        if not document or not document.strip():
            continue

        text = document.strip()

        if text in seen:
            continue

        seen.add(text)

        passages.append({
            "text": text,
            "source": metadata.get("source", "Unknown"),
            "page": metadata.get("page", "Unknown"),
            "distance": results["distances"][0][i],
        })

    return passages


if __name__ == "__main__":
    question = input(
        "Ask a question about your university PDFs: "
    )

    passages = retrieve_documents(question, top_k=5)

    if not passages:
        print("\nNo relevant passages found.")
    else:
        print("\nMost relevant passages:\n")

        for number, passage in enumerate(passages, start=1):
            print(f"--- Result {number} ---")
            print(f"Source: {passage['source']}")
            print(f"Page: {passage['page']}")
            print(f"Distance: {passage['distance']:.4f}")
            print(f"Text: {passage['text']}\n")
