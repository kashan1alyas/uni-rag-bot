import { isQuizAnswerCorrect } from "./quizScoring.js";

export function scoreExamPractice(questions, answers, selfRatings) {
  return questions.reduce(
    (result, question, index) => {
      if (question.question_type === "mcq") {
        result.graded += 1;
        if (isQuizAnswerCorrect(question, answers[index])) {
          result.correct += 1;
        }
      } else if (selfRatings[index]) {
        result.graded += 1;
        if (selfRatings[index] === "mastered") {
          result.correct += 1;
        }
      } else {
        result.pending += 1;
      }
      return result;
    },
    { correct: 0, graded: 0, pending: 0 }
  );
}

export function getWeakExamTopics(questions, answers, selfRatings) {
  return [...new Set(
    questions
      .filter((question, index) => (
        question.question_type === "mcq"
          ? !isQuizAnswerCorrect(question, answers[index])
          : selfRatings[index] === "revise"
      ))
      .map((question) => question.topic)
  )];
}
