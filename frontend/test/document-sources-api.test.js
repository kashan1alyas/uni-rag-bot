import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  DOCUMENT_SOURCES_TIMEOUT_MS,
  listDocumentSources,
} from "../src/documentSourcesApi.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("document source requests return the source list and preserve API errors", async () => {
  globalThis.fetch = async () =>
    Response.json({ sources: ["lecture.pdf", "week-2.pdf"] });
  assert.deepEqual(
    await listDocumentSources("http://api.test/sources", "notes service"),
    ["lecture.pdf", "week-2.pdf"]
  );

  globalThis.fetch = async () =>
    Response.json({ detail: "Index is unavailable." }, { status: 503 });
  await assert.rejects(
    listDocumentSources("http://api.test/sources", "notes service"),
    /Index is unavailable/
  );
});

test("document source requests report connection, invalid-response, and timeout errors", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    listDocumentSources("http://api.test/sources", "quiz service"),
    /Could not load lecture PDFs from the quiz service/
  );

  globalThis.fetch = async () => Response.json({ sources: "not-an-array" });
  await assert.rejects(
    listDocumentSources("http://api.test/sources", "quiz service"),
    /invalid lecture document list/
  );

  globalThis.fetch = async (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true }
      );
    });
  await assert.rejects(
    listDocumentSources("http://api.test/sources", "quiz service", 5),
    /Loading lecture PDFs timed out/
  );
  assert.equal(DOCUMENT_SOURCES_TIMEOUT_MS, 20_000);
});
