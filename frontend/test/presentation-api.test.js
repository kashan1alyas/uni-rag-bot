import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  downloadPresentationPptx,
  generatePresentation,
  listPresentationSources,
} from "../src/presentationApi.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("presentation API loads sources, generates slides, and exports a PowerPoint", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/sources")) {
      return Response.json({ sources: ["lecture.pdf"] });
    }
    if (url.endsWith("/generate")) {
      return Response.json({
        title: "Neural Networks",
        slides: [{ title: "Introduction", key_points: ["A model"] }],
      });
    }
    return new Response("editable-pptx");
  };

  assert.deepEqual(await listPresentationSources(), ["lecture.pdf"]);
  const request = {
    topic: "Neural Networks",
    slide_count: 8,
    language: "English",
    style: "Academic",
    all_documents: false,
    selected_sources: ["lecture.pdf"],
  };
  assert.equal((await generatePresentation(request)).slides.length, 1);
  assert.equal((await downloadPresentationPptx({
    title: "Neural Networks",
    language: "English",
    style: "Academic",
    slides: [],
  })).size, 13);
  assert.deepEqual(JSON.parse(calls[1].options.body), request);
  assert.equal(calls[2].url.endsWith("/pptx"), true);
});

test("presentation API reports HTTP and connection failures", async () => {
  globalThis.fetch = async () =>
    Response.json({ detail: "No relevant lecture material." }, { status: 404 });
  await assert.rejects(listPresentationSources, /No relevant lecture material/);

  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(generatePresentation({}), /Could not connect to the presentation service/);
});
