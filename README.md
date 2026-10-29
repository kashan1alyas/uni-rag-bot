# University RAG Chatbot

A university-document question-answering project built around retrieval-augmented generation (RAG). The backend extracts and chunks text from local lecture PDFs, creates embeddings, and stores them in ChromaDB for semantic retrieval. A React frontend and FastAPI backend are included.

The chat endpoint retrieves relevant passages from the local ChromaDB database and uses Groq's `openai/gpt-oss-20b` model to draft a student-friendly answer with PDF filename and page citations. The Assignment Assistant uses the same retrieval and Groq setup to create an editable, structured draft from the student's prompt, instructions, and requirements.

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

Create a root `.env` file and add your Groq API key:

```dotenv
GROQ_API_KEY=YOUR_API_KEY_HERE
```

Replace the placeholder with your key. Keep `.env` local; it is ignored by Git.

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

   The API is available at `http://127.0.0.1:8000`. Interactive API documentation is at `http://127.0.0.1:8000/docs`; `/health` is a health check, `/api/test` checks the frontend connection, and `POST /api/chat` answers questions using the indexed PDFs and Groq.

3. **Start the frontend** in a second terminal:

   ```powershell
   cd frontend
   npm run dev
   ```

   Open the local URL printed by Vite (normally `http://localhost:5173`) to ask questions and review answers and citations. Select **Assignment Assistant** in the top bar to enter assignment details, generate a draft grounded in relevant indexed documents, edit or copy it, and download a formatted PDF. Add university and student details and an optional PNG/JPEG logo for the PDF cover. **Test Backend Connection** remains available at the bottom of the chat.

To test the chat API directly while the backend is running, use a second PowerShell terminal from the project root:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8000/api/chat -Method Post -ContentType "application/json" -Body '{"question":"What is logistic regression?"}'
```

No PDF re-ingestion is needed if the existing ChromaDB vector database is already populated.

The assignment PDF is generated locally by the FastAPI endpoint `POST /api/assignment/pdf` using PyMuPDF. The cover logo is optional and is only included in the exported document.

The retrieval helper can also be run directly after ingestion:

```powershell
cd backend
python rag.py
```

The vector database is generated under `backend\vector_db\` and is intentionally not tracked.

## Local data and Git

Keep PDFs in `backend\data\` and generated ChromaDB files in `backend\vector_db\`. Both are excluded from version control, along with Python virtual environments, bytecode, and `.env` files. Do not commit credentials or private course materials.
