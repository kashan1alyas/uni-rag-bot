import { listDocumentSources } from "./documentSourcesApi";

const RESEARCH_URL = "http://127.0.0.1:8000/api/research";

async function readError(response, fallback) {
  const data = await response.json().catch(() => ({}));
  const detail = Array.isArray(data.detail)
    ? data.detail.map((item) => item.msg).join("; ")
    : data.detail;
  return detail || fallback;
}

async function requestResearchFile(path, request, fallback) {
  let response;
  try {
    response = await fetch(`${RESEARCH_URL}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (error) {
    throw new Error(
      "Could not connect to the research assistant. Make sure FastAPI is running.",
      { cause: error }
    );
  }
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  const file = await response.blob();
  if (file.size === 0) {
    throw new Error("The research assistant returned an empty export file.");
  }
  return file;
}

export async function listResearchSources() {
  return listDocumentSources(
    `${RESEARCH_URL}/sources`,
    "research assistant"
  );
}

export async function generateResearch(request) {
  let response;
  try {
    response = await fetch(`${RESEARCH_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (error) {
    throw new Error(
      "Could not connect to the research assistant. Make sure FastAPI is running.",
      { cause: error }
    );
  }
  if (!response.ok) {
    throw new Error(
      await readError(response, "Research content could not be generated.")
    );
  }
  return response.json();
}

export function downloadResearchPdf(request) {
  return requestResearchFile(
    "pdf",
    request,
    "The research PDF could not be created."
  );
}

export function downloadResearchDocx(request) {
  return requestResearchFile(
    "docx",
    request,
    "The research DOCX could not be created."
  );
}
