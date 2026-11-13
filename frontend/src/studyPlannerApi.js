import { listDocumentSources } from "./documentSourcesApi.js";

const STUDY_PLANNER_URL = "http://127.0.0.1:8000/api/study-planner";

async function readError(response, fallback) {
  const data = await response.json().catch(() => ({}));
  const detail = Array.isArray(data.detail)
    ? data.detail.map((item) => item.msg).join("; ")
    : data.detail;
  return detail || fallback;
}

async function request(path, { method = "GET", body } = {}, fallback) {
  let response;
  try {
    response = await fetch(`${STUDY_PLANNER_URL}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
  } catch (error) {
    throw new Error(
      "Could not connect to the study planner service. Make sure FastAPI is running.",
      { cause: error }
    );
  }

  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  return response.json();
}

export async function listStudyPlannerSources() {
  return listDocumentSources(
    `${STUDY_PLANNER_URL}/sources`,
    "study planner service"
  );
}

export async function listStudyPlans() {
  const data = await request(
    "",
    {},
    "Saved study plans could not be loaded."
  );
  if (!data || !Array.isArray(data.plans)) {
    throw new Error("The study planner returned an invalid saved-plan list.");
  }
  return data.plans;
}

export function generateStudyPlan(plan) {
  return request(
    "/generate",
    { method: "POST", body: plan },
    "The study timetable could not be generated."
  );
}

export function updateStudyTask(taskId, changes) {
  return request(
    `/tasks/${encodeURIComponent(taskId)}`,
    { method: "PATCH", body: changes },
    "The study task could not be updated."
  );
}

export function deleteStudyTask(taskId) {
  return request(
    `/tasks/${encodeURIComponent(taskId)}`,
    { method: "DELETE" },
    "The study task could not be deleted."
  );
}
