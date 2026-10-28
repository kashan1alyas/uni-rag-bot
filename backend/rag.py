
from pathlib import Path

import chromadb
from sentence_transformers import SentenceTransformer


BACKEND_DIR = Path(__file__).resolve().parent
VECTOR_DB_DIR = BACKEND_DIR / "vector_db"
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"


def retrieve_documents(question: str, top_k: int = 3):
    """Retrieve the most relevant passages from the university PDFs."""

    if not question.strip():
        return []

    client = chromadb.PersistentClient(
        path=str(VECTOR_DB_DIR)
    )

    collection = client.get_collection("university_docs")

    model = SentenceTransformer(
        MODEL_NAME,
        local_files_only=True,
    )

    question_embedding = model.encode(
        question,
        normalize_embeddings=True,
    ).tolist()

    results = collection.query(
        query_embeddings=[question_embedding],
        n_results=min(top_k, collection.count()),
        include=["documents", "metadatas", "distances"],
    )

    passages = []

    for i, document in enumerate(results["documents"][0]):
        metadata = results["metadatas"][0][i]
        distance = results["distances"][0][i]

        passages.append({
            "text": document,
            "source": metadata["source"],
            "page": metadata["page"],
            "distance": distance,
        })

    return passages


if __name__ == "__main__":
    question = input("Ask a question about your university PDFs: ")

    passages = retrieve_documents(question)

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
