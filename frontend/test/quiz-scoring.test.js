import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isQuizAnswerCorrect,
  scoreQuiz,
} from "../src/quizScoring.js";

const questions = [
  { question_type: "mcq", correct_answer: "A relationship" },
  { question_type: "true_false", correct_answer: "False" },
  { question_type: "short_answer", correct_answer: "dependent variable" },
];

test("quiz scoring compares answers without case or whitespace sensitivity", () => {
  assert.equal(
    scoreQuiz(questions, {
      0: "a relationship",
      1: "False",
      2: "  DEPENDENT   variable ",
    }),
    3
  );
  assert.equal(
    scoreQuiz(questions, {
      0: "A relationship",
      1: "True",
      2: "",
    }),
    1
  );
  assert.equal(isQuizAnswerCorrect(questions[1], undefined), false);
});
