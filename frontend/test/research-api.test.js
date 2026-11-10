import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  downloadResearchDocx,
  downloadResearchPdf,
  generateResearch,
  listResearchSources,
} from "../src/researchApi.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("research API loads sources, generates drafts, and exports PDF and DOCX", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/sources")) {
      return Response.json({ sources: ["paper.pdf"] });
    }
    if (url.endsWith("/generate")) {
      return Response.json({
        title: "Research topic",
        citation_style: "APA",
        content: "# Research topic",
        sources: ["paper.pdf"],
      });
    }
    return new Response(url.endsWith("/pdf") ? "pdf bytes" : "docx bytes");
  };

  assert.deepEqual(await listResearchSources(), ["paper.pdf"]);
  const request = {
    topic: "How do students learn?",
    citation_style: "APA",
    all_documents: false,
    selected_sources: ["paper.pdf"],
  };
  assert.equal((await generateResearch(request)).citation_style, "APA");
  const exportRequest = {
    title: "Learning",
    content: "# Research",
    sources: ["paper.pdf"],
  };
  assert.equal((await downloadResearchPdf(exportRequest)).size, 9);
  assert.equal((await downloadResearchDocx(exportRequest)).size, 10);
  assert.deepEqual(JSON.parse(calls[1].options.body), request);
  assert.equal(calls[2].url.endsWith("/pdf"), true);
  assert.equal(calls[3].url.endsWith("/docx"), true);
});

test("research API reports HTTP, connection, and empty-export errors", async () => {
  globalThis.fetch = async () =>
    Response.json({ detail: "Select fewer PDFs." }, { status: 422 });
  await assert.rejects(listResearchSources, /Select fewer PDFs/);

  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    generateResearch({}),
    /Could not connect to the research assistant/
  );

  globalThis.fetch = async () => new Response(null);
  await assert.rejects(
    downloadResearchPdf({}),
    /returned an empty export file/
  );
});
