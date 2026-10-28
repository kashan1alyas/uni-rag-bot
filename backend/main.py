from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app=FastAPI(title="university Rag Bot", description="A bot that helps students with university-related queries.", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
@app.get("/")
async def root():
    return {"message": "Welcome to the University Rag Bot API!"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/api/test")
def test_connection():
    return {
        "message": "React and FastAPI are connected successfully!"
    }
