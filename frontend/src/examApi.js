const EXAM_URL = "http://127.0.0.1:8000/api/exam";

async function readError(response, fallback) {
  const data = await response.json().catch(() => ({}));
  const detail = Array.isArray(data.detail)
    ? data.detail.map((item) => item.msg).join("; ")
    : data.detail;
  return detail || fallback;
}

async function postExamRequest(path, request, fallback) {
  let response;
  try {
    response = await fetch(`${EXAM_URL}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (error) {
    throw new Error(
      "Could not connect to the exam preparation service. Make sure FastAPI is running.",
      { cause: error }
    );
  }
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  return response.json();
}

export async function listExamSources() {
  let response;
  try {
    response = await fetch(`${EXAM_URL}/sources`);
  } catch (error) {
    throw new Error(
      "Could not connect to the exam preparation service. Make sure FastAPI is running.",
      { cause: error }
    );
  }
  if (!response.ok) {
    throw new Error(await readError(response, "Lecture PDFs could not be loaded."));
  }
  const data = await response.json();
  return data.sources;
}

export function generateExamPlan(request) {
  return postExamRequest(
    "plan",
    request,
    "The exam study plan could not be generated."
  );
}

export function generateExamPractice(request) {
  return postExamRequest(
    "practice",
    request,
    "Practice questions could not be generated."
  );
}
