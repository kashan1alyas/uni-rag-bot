import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  deleteStudyTask,
  generateStudyPlan,
  listStudyPlans,
  listStudyPlannerSources,
  updateStudyTask,
} from "../src/studyPlannerApi.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("study planner API loads plans and lecture PDFs and manages tasks", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/sources")) {
      return Response.json({ sources: ["biology.pdf"] });
    }
    if (url.endsWith("/generate")) {
      return Response.json({ id: "plan-1", tasks: [] }, { status: 201 });
    }
    if (url.endsWith("/tasks/task%2F1") && options.method === "PATCH") {
      return Response.json({ id: "task/1", completed: true });
    }
    if (url.endsWith("/tasks/task%2F1") && options.method === "DELETE") {
      return Response.json({ deleted: true, task_id: "task/1" });
    }
    return Response.json({ plans: [{ id: "plan-1", tasks: [] }] });
  };

  assert.deepEqual(await listStudyPlannerSources(), ["biology.pdf"]);
  assert.deepEqual(await listStudyPlans(), [{ id: "plan-1", tasks: [] }]);
  const planRequest = {
    subjects: [
      {
        subject: "Biology",
        exam_date: "2026-12-01",
        topics: [{ name: "Cell division", difficulty: "Hard" }],
      },
    ],
    available_hours: 2,
    start_time: "09:00",
    selected_sources: ["biology.pdf"],
  };
  assert.equal((await generateStudyPlan(planRequest)).id, "plan-1");
  assert.equal(
    (await updateStudyTask("task/1", { completed: true })).completed,
    true
  );
  assert.equal((await deleteStudyTask("task/1")).deleted, true);

  assert.equal(calls[0].url, "http://127.0.0.1:8000/api/study-planner/sources");
  assert.equal(calls[2].url, "http://127.0.0.1:8000/api/study-planner/generate");
  assert.deepEqual(JSON.parse(calls[2].options.body), planRequest);
  assert.equal(
    calls[3].url,
    "http://127.0.0.1:8000/api/study-planner/tasks/task%2F1"
  );
  assert.deepEqual(JSON.parse(calls[3].options.body), { completed: true });
  assert.equal(calls[4].options.method, "DELETE");
});

test("study planner API preserves server errors and reports connection failures", async () => {
  globalThis.fetch = async () =>
    Response.json(
      { detail: "The study timetable exceeded the available hours." },
      { status: 502 }
    );
  await assert.rejects(generateStudyPlan({}), /exceeded the available hours/);

  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    listStudyPlans(),
    /Could not connect to the study planner service/
  );
});
