import { listDocumentSources } from "./documentSourcesApi";

const CODING_URL = "http://127.0.0.1:8000/api/code";

async function readError(response, fallback) {
  const data = await response.json().catch(() => ({}));
  const detail = Array.isArray(data.detail)
    ? data.detail.map((item) => item.msg).join("; ")
    : data.detail;
  return detail || fallback;
}

export async function listCodingSources() {
  return listDocumentSources(`${CODING_URL}/sources`, "coding service");
}

export async function generateCode(request) {
  let response;
  try {
    response = await fetch(`${CODING_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (error) {
    throw new Error(
      "Could not connect to the coding service. Make sure FastAPI is running.",
      { cause: error }
    );
  }
  if (!response.ok) {
    throw new Error(await readError(response, "The code could not be generated."));
  }
  return response.json();
}