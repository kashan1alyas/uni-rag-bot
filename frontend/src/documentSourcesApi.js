export const DOCUMENT_SOURCES_TIMEOUT_MS = 20_000;

async function readError(response, fallback) {
  const data = await response.json().catch(() => ({}));
  const detail = Array.isArray(data.detail)
    ? data.detail.map((item) => item.msg).join("; ")
    : data.detail;
  return detail || fallback;
}

export async function listDocumentSources(
  url,
  serviceName,
  timeoutMs = DOCUMENT_SOURCES_TIMEOUT_MS
) {
  const controller = new AbortController();
  let timeoutId;
  const timedOut = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      controller.abort();
      reject(
        new Error(
          "Loading lecture PDFs timed out. Check that FastAPI is running, then retry."
        )
      );
    }, timeoutMs);
  });
  const request = (async () => {
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (error) {
      throw new Error(
        `Could not load lecture PDFs from the ${serviceName}. Check that FastAPI is running and that this frontend origin is allowed.`,
        { cause: error }
      );
    }

    if (!response.ok) {
      throw new Error(
        await readError(response, "Lecture PDFs could not be loaded.")
      );
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error(
        `The ${serviceName} returned an invalid lecture document response.`,
        { cause: error }
      );
    }
    if (
      !data ||
      !Array.isArray(data.sources) ||
      data.sources.some((source) => typeof source !== "string")
    ) {
      throw new Error(
        `The ${serviceName} returned an invalid lecture document list.`
      );
    }
    return data.sources;
  })();

  try {
    return await Promise.race([request, timedOut]);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        "Loading lecture PDFs timed out. Check that FastAPI is running, then retry.",
        { cause: error }
      );
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}
