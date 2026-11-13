import { listDocumentSources } from "./documentSourcesApi";

const NOTES_URL = "http://127.0.0.1:8000/api/notes";

async function readError(response, fallback) {
  const data = await response.json().catch(() => ({}));
  const detail = Array.isArray(data.detail)
    ? data.detail.map((item) => item.msg).join("; ")
    : data.detail;
  return detail || fallback;
}

export async function listNotesSources() {
  return listDocumentSources(`${NOTES_URL}/sources`, "notes service");
}

export async function generateNotes(request) {
  let response;
  try {
    response = await fetch(NOTES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (error) {
    throw new Error(
      "Could not connect to the notes service. Make sure FastAPI is running.",
      { cause: error }
    );
  }
  if (!response.ok) {
    throw new Error(await readError(response, "Notes could not be generated."));
  }
  return response.json();
}

export async function downloadNotesPdf(request) {
  let response;
  try {
    response = await fetch(`${NOTES_URL}/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (error) {
    throw new Error(
      "Could not connect to the notes PDF service. Make sure FastAPI is running.",
      { cause: error }
    );
  }
  if (!response.ok) {
    throw new Error(await readError(response, "The notes PDF could not be created."));
  }
  return response.blob();
}
