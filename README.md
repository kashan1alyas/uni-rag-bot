# University RAG Chatbot

A university-document question-answering project built around retrieval-augmented generation (RAG). The backend extracts and chunks text from local lecture PDFs, creates embeddings, and stores them in ChromaDB for semantic retrieval. A React frontend and FastAPI backend are included.

The chat endpoint retrieves relevant passages from the local ChromaDB database and uses Groq's `openai/gpt-oss-20b` model to draft a student-friendly answer with PDF filename and page citations. Welcome-screen study suggestions are generated from the indexed PDFs and refresh after uploads. The Notes Generator creates editable short, detailed, or topic-wise notes from selected indexed PDFs. The Quiz Generator creates document-grounded multiple-choice, true/false, and short-answer quizzes with answers, explanations, and source citations. Exam Preparation Mode creates a source-grounded study schedule, tracks completed topics, and generates mixed-format mock exams with answer explanations and weak-topic practice. The AI Study Planner generates editable, persistent daily and weekly timetables from subjects, topic difficulty, exam dates, study availability, and selected lecture PDFs; it includes breaks and revision, and tracks task completion and progress. Build your Presentation generates source-cited editable slide decks and exports PowerPoint files. The Research Assistant creates cited outlines, objectives, problem statements, literature summaries, research questions, and paper analyses, with editable PDF and DOCX exports. Research drafts are explicitly marked as AI-generated and require verification against the original papers.

## Technology

- **Backend:** Python, FastAPI, Uvicorn
- **Chat history:** SQLite, SQLAlchemy
- **Document processing:** PyMuPDF, python-pptx, python-docx
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

   The API is available at `http://127.0.0.1:8000`. Interactive API documentation is at `http://127.0.0.1:8000/docs`; `/health` is a health check, `/api/test` checks the frontend connection, `GET /api/suggestions` returns study questions based on the indexed PDFs, and `POST /api/chat` answers questions using the indexed PDFs and Groq.

   Chat history is stored in `backend\chat_history.db`, which is created automatically. `GET /api/conversations` lists chats; `GET /api/conversations/{id}` loads one; `POST /api/conversations` creates one; `POST /api/conversations/{id}/messages` saves messages; `PATCH /api/conversations/{id}` renames one; and `DELETE /api/conversations/{id}` deletes one. Existing browser-stored history is left in place; use **Export old browser history** in the sidebar to download it as JSON before switching, if desired.

   The Notes Generator reads indexed document sources from `GET /api/notes/sources`, generates notes with `POST /api/notes`, and exports them with `POST /api/notes/pdf`. Select the PDFs in the sidebar Notes Generator; use **All available lecture documents** to include every indexed PDF.

   The Quiz Generator reads indexed document sources from `GET /api/quiz/sources` and creates a quiz with `POST /api/quiz`. Select a PDF or all indexed documents, set 3-20 questions and a difficulty, then submit answers to see your score, correct answers, explanations, and citations.

   Exam Preparation Mode reads indexed documents from `GET /api/exam/sources`, builds a topic-wise plan with `POST /api/exam/plan`, and generates mixed MCQ, short-answer, and long-answer practice with `POST /api/exam/practice`. Select multiple indexed PDFs or attach multiple new PDFs, enter the subject, exam date, and daily study hours, then track completed topics. MCQs are automatically scored; written answers reveal model answers and explanations for self-review. Missed and self-marked topics can be used to generate focused practice.

   The AI Study Planner reads indexed PDFs from `GET /api/study-planner/sources`, generates a seven-day timetable with `POST /api/study-planner/generate`, and saves plans and tasks in the existing SQLite database. Add subjects, topics, difficulty, exam dates, daily available hours, and an optional start time; select indexed PDFs or upload new ones to ground the plan in lecture material. View daily and weekly progress, mark tasks complete, edit or reschedule them with `PATCH /api/study-planner/tasks/{id}`, and delete tasks with `DELETE /api/study-planner/tasks/{id}`. `GET /api/study-planner` returns saved plans.

   Build your Presentation reads available PDFs from `GET /api/presentations/sources` and creates a source-grounded deck with `POST /api/presentations/generate`. Enter a topic and optionally select PDFs or attach new ones, then choose the slide count, language, and style. Edit and preview the generated slides, then export an editable PowerPoint file with `POST /api/presentations/pptx`. Topic-only requests retrieve relevant indexed lecture material; generation reports an error if no relevant material is available.

   The Research Assistant lists indexed documents with `GET /api/research/sources` and generates a source-cited research draft with `POST /api/research/generate`. Enter a topic or question, select up to 12 PDFs (or use all indexed PDFs when there are 12 or fewer), and choose APA, MLA, or IEEE citations. Attach PDFs through the existing upload flow. Edit, copy, or export the result using `POST /api/research/pdf` and `POST /api/research/docx`. The assistant extracts bibliographic fields only when they appear in indexed PDF text, checks them against that text, and cites source filenames/pages. Missing details use an explicit filename fallback and must be completed and verified against the original publication. Generated interpretations and proposed research questions are not independently verified findings.

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

Run the chat-history API tests from the project root with:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend -p "test_*.py"
```

Run the frontend chat-history tests from `frontend\` with:

```powershell
npm run test:chat-history
```

Run the notes API client tests from `frontend\` with:

```powershell
npm run test:notes
```

Run the quiz API client tests from `frontend\` with:

```powershell
npm run test:quiz
```

Run the exam preparation client and scoring tests from `frontend\` with:

```powershell
npm run test:exam
```

Run the presentation API client tests from `frontend\` with:

```powershell
npm run test:presentation
```

Run the research assistant API client tests from `frontend\` with:

```powershell
npm run test:research
```

Run the study planner API client tests from `frontend\` with:

```powershell
node --test test/study-planner-api.test.js
```

## Local data and Git

Keep PDFs in `backend\data\`, generated ChromaDB files in `backend\vector_db\`, and the local chat-history database in `backend\chat_history.db`. These are excluded from version control, along with Python virtual environments, bytecode, and `.env` files. Do not commit credentials or private course materials.
