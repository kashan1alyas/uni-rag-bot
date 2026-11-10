import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  downloadNotesPdf,
  generateNotes,
  listNotesSources,
} from "../src/notesApi.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("notes API loads available sources, generates notes, and downloads a PDF", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/sources")) {
      return Response.json({ sources: ["lecture.pdf"] });
    }
    if (url.endsWith("/pdf")) {
      return new Response(new Blob(["%PDF-test"]), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    }
    return Response.json({ notes: "# Study notes", sources: ["lecture.pdf"] });
  };

  assert.deepEqual(await listNotesSources(), ["lecture.pdf"]);
  const generated = await generateNotes({
    note_type: "topic_wise",
    all_documents: false,
    selected_sources: ["lecture.pdf"],
  });
  assert.equal(generated.notes, "# Study notes");
  assert.deepEqual(
    JSON.parse(calls[1].options.body).selected_sources,
    ["lecture.pdf"]
  );
  assert.match(
    await (await downloadNotesPdf({
      title: "Test",
      notes: "Notes",
      sources: ["lecture.pdf"],
    })).text(),
    /%PDF-test/
  );
});

test("notes API reports backend and connection errors", async () => {
  globalThis.fetch = async () =>
    Response.json({ detail: "No indexed lecture documents." }, { status: 503 });
  await assert.rejects(listNotesSources, /No indexed lecture documents/);

  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    generateNotes({}),
    /Could not connect to the notes service/
  );
});
