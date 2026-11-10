import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getWeakExamTopics,
  scoreExamPractice,
} from "../src/examScoring.js";

const questions = [
  {
    question_type: "mcq",
    topic: "Regression",
    correct_answer: "Linear",
  },
  {
    question_type: "short",
    topic: "Correlation",
    correct_answer: "A measure of relationship",
  },
  {
    question_type: "long",
    topic: "Regression",
    correct_answer: "Model explanation",
  },
];

test("exam results combine MCQ grading with written self-review", () => {
  const answers = { 0: "Wrong", 1: "My response", 2: "My essay" };
  const ratings = { 1: "mastered", 2: "revise" };
  assert.deepEqual(scoreExamPractice(questions, answers, ratings), {
    correct: 1,
    graded: 3,
    pending: 0,
  });
  assert.deepEqual(getWeakExamTopics(questions, answers, ratings), [
    "Regression",
  ]);
});

test("unrated written responses remain pending and are not marked weak", () => {
  assert.deepEqual(
    scoreExamPractice(questions, { 0: "Linear" }, {}),
    { correct: 1, graded: 1, pending: 2 }
  );
  assert.deepEqual(getWeakExamTopics(questions, { 0: "Linear" }, {}), []);
});
