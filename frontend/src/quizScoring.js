function normalizeAnswer(answer) {
  return answer.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function isQuizAnswerCorrect(question, answer) {
  return normalizeAnswer(answer || "") === normalizeAnswer(question.correct_answer);
}

export function scoreQuiz(questions, answers) {
  return questions.reduce((score, question, index) => {
    return score + (isQuizAnswerCorrect(question, answers[index]) ? 1 : 0);
  }, 0);
}
