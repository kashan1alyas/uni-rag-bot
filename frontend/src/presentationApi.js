const PRESENTATION_URL = "http://127.0.0.1:8000/api/presentations";

async function readError(response, fallback) {
  const data = await response.json().catch(() => ({}));
  const detail = Array.isArray(data.detail)
    ? data.detail.map((item) => item.msg).join("; ")
    : data.detail;
  return detail || fallback;
}

async function postPresentationRequest(path, request, fallback) {
  let response;
  try {
    response = await fetch(`${PRESENTATION_URL}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (error) {
    throw new Error(
      "Could not connect to the presentation service. Make sure FastAPI is running.",
      { cause: error }
    );
  }
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  return response;
}

export async function listPresentationSources() {
  let response;
  try {
    response = await fetch(`${PRESENTATION_URL}/sources`);
  } catch (error) {
    throw new Error(
      "Could not connect to the presentation service. Make sure FastAPI is running.",
      { cause: error }
    );
  }
  if (!response.ok) {
    throw new Error(
      await readError(response, "Lecture PDFs could not be loaded.")
    );
  }
  const data = await response.json();
  return data.sources;
}

export async function generatePresentation(request) {
  const response = await postPresentationRequest(
    "generate",
    request,
    "The presentation could not be generated."
  );
  return response.json();
}

export async function downloadPresentationPptx(request) {
  const response = await postPresentationRequest(
    "pptx",
    request,
    "The PowerPoint file could not be created."
  );
  const file = await response.blob();
  if (file.size === 0) {
    throw new Error("The presentation service returned an empty PowerPoint file.");
  }
  return file;
}
