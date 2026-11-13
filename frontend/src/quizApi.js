import { listDocumentSources } from "./documentSourcesApi";

const QUIZ_URL = "http://127.0.0.1:8000/api/quiz";

async function readError(response, fallback) {
  const data = await response.json().catch(() => ({}));
  const detail = Array.isArray(data.detail)
    ? data.detail.map((item) => item.msg).join("; ")
    : data.detail;
  return detail || fallback;
}

export async function listQuizSources() {
  return listDocumentSources(`${QUIZ_URL}/sources`, "quiz service");
}

export async function generateQuiz(request) {
  let response;
  try {
    response = await fetch(QUIZ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (error) {
    throw new Error(
      "Could not connect to the quiz service. Make sure FastAPI is running.",
      { cause: error }
    );
  }
  if (!response.ok) {
    throw new Error(await readError(response, "The quiz could not be generated."));
  }
  return response.json();
}
