# University RAG Chatbot

A university-document question-answering project built around retrieval-augmented generation (RAG). The backend extracts and chunks text from local lecture PDFs, creates embeddings, and stores them in ChromaDB for semantic retrieval. A React frontend and FastAPI backend are included.

> **Project status:** PDF ingestion and passage retrieval are implemented. The current FastAPI app exposes health and connection-test endpoints; a conversational API endpoint and frontend chat interface are not implemented yet.

## Technology

- **Backend:** Python, FastAPI, Uvicorn
- **Document processing:** PyMuPDF
- **Embeddings:** Sentence Transformers (`sentence-transformers/all-MiniLM-L6-v2`)
- **Vector storage:** ChromaDB
- **Frontend:** React, Vite, JavaScript

## Requirements

- Python 3.10 or later
- Node.js and npm
- Local lecture PDFs to index (not included in Git)

## Setup

Run these commands from the project root in PowerShell.

### Backend

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
```

Place the PDFs you want to index in `backend\data\`. They remain local and are excluded from Git.

### Frontend

```powershell
cd frontend
npm ci
cd ..
```

## Usage

1. **Build or refresh the local vector database** after adding PDFs:

   ```powershell
   cd backend
   python ingest.py
   cd ..
   ```

   The first ingestion may download the embedding model.

2. **Start the API** from the backend directory:

   ```powershell
   cd backend
   python -m uvicorn main:app --reload
   ```

   The API is available at `http://127.0.0.1:8000`. Interactive API documentation is at `http://127.0.0.1:8000/docs`; `/health` is a health check and `/api/test` is used by the current frontend connection check.

3. **Start the frontend** in a second terminal:

   ```powershell
   cd frontend
   npm run dev
   ```

   Open the local URL printed by Vite (normally `http://localhost:5173`) and use **Test Backend Connection**.

The retrieval helper can also be run directly after ingestion:

```powershell
cd backend
python rag.py
```

The vector database is generated under `backend\vector_db\` and is intentionally not tracked.

## Local data and Git

Keep PDFs in `backend\data\` and generated ChromaDB files in `backend\vector_db\`. Both are excluded from version control, along with Python virtual environments, bytecode, and `.env` files. Do not commit credentials or private course materials.
