import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { generateQuiz, listQuizSources } from "../src/quizApi.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("quiz API loads lecture sources and submits quiz settings", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/sources")) {
      return Response.json({ sources: ["lecture.pdf"] });
    }
    return Response.json({
      difficulty: "Medium",
      sources: ["lecture.pdf"],
      questions: [
        {
          question_type: "true_false",
          question: "Example?",
          options: [],
          correct_answer: "True",
          explanation: "Shown in the source.",
          source: "lecture.pdf",
          page: "1",
        },
      ],
    });
  };

  assert.deepEqual(await listQuizSources(), ["lecture.pdf"]);
  const quiz = await generateQuiz({
    question_count: 3,
    difficulty: "Medium",
    all_documents: false,
    selected_sources: ["lecture.pdf"],
  });
  assert.equal(quiz.questions.length, 1);
  assert.equal(calls[1].url, "http://127.0.0.1:8000/api/quiz");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    question_count: 3,
    difficulty: "Medium",
    all_documents: false,
    selected_sources: ["lecture.pdf"],
  });
});

test("quiz API reports backend and connection errors", async () => {
  globalThis.fetch = async () =>
    Response.json({ detail: "No indexed lecture documents." }, { status: 503 });
  await assert.rejects(listQuizSources, /No indexed lecture documents/);

  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    generateQuiz({}),
    /Could not connect to the quiz service/
  );
});
