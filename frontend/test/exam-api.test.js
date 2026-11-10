import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  generateExamPlan,
  generateExamPractice,
  listExamSources,
} from "../src/examApi.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("exam API loads sources and submits plan and practice requests", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/sources")) {
      return Response.json({ sources: ["lecture.pdf"] });
    }
    if (url.endsWith("/plan")) {
      return Response.json({ topics: [{ topic: "Regression" }], schedule: [] });
    }
    return Response.json({
      questions: [{ question_type: "mcq", topic: "Regression" }],
    });
  };

  assert.deepEqual(await listExamSources(), ["lecture.pdf"]);
  const planRequest = {
    subject: "Statistics",
    exam_date: "2026-12-01",
    study_hours_per_day: 2,
    all_documents: false,
    selected_sources: ["lecture.pdf"],
  };
  assert.equal((await generateExamPlan(planRequest)).topics[0].topic, "Regression");
  const practiceRequest = {
    subject: "Statistics",
    question_count: 9,
    difficulty: "Hard",
    focus_topics: ["Regression"],
    all_documents: false,
    selected_sources: ["lecture.pdf"],
  };
  assert.equal(
    (await generateExamPractice(practiceRequest)).questions.length,
    1
  );
  assert.deepEqual(JSON.parse(calls[1].options.body), planRequest);
  assert.deepEqual(JSON.parse(calls[2].options.body), practiceRequest);
});

test("exam API reports server and connection errors", async () => {
  globalThis.fetch = async () =>
    Response.json({ detail: "No indexed documents." }, { status: 404 });
  await assert.rejects(listExamSources, /No indexed documents/);

  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    generateExamPlan({}),
    /Could not connect to the exam preparation service/
  );
});
