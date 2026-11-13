import { useEffect, useMemo, useState } from "react";
import {
  deleteStudyTask,
  generateStudyPlan,
  listStudyPlans,
  listStudyPlannerSources,
  updateStudyTask,
} from "./studyPlannerApi";
import "./StudyPlanner.css";

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

function createSubject() {
  return {
    id: `${Date.now()}-${Math.random()}`,
    subject: "",
    exam_date: addDays(localDateString(new Date()), 1),
    topics: [
      {
        id: `${Date.now()}-topic-${Math.random()}`,
        name: "",
        difficulty: "Medium",
      },
    ],
  };
}

function updateTaskInPlans(plans, updatedTask) {
  return plans.map((plan) => ({
    ...plan,
    tasks: plan.tasks
      .map((task) => (task.id === updatedTask.id ? updatedTask : task))
      .sort((first, second) =>
        `${first.scheduled_date}-${first.start_time}`.localeCompare(
          `${second.scheduled_date}-${second.start_time}`
        )
      ),
  }));
}

function getProgress(tasks) {
  const studyTasks = tasks.filter((task) => task.task_type !== "break");
  const completed = studyTasks.filter((task) => task.completed).length;
  return {
    completed,
    total: studyTasks.length,
    percent: studyTasks.length
      ? Math.round((completed / studyTasks.length) * 100)
      : 0,
  };
}

function formatTime(value) {
  const [hour, minute] = value.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function ProgressCard({ label, progress }) {
  return (
    <article className="planner-progress-card">
      <div>
        <strong>{label}</strong>
        <span>
          {progress.completed} of {progress.total} study sessions complete
        </span>
      </div>
      <strong className="planner-progress-percent">{progress.percent}%</strong>
      <div
        className="planner-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
      >
        <span style={{ width: `${progress.percent}%` }} />
      </div>
    </article>
  );
}

function StudyTaskCard({ task, onComplete, onDelete, onSave, saving }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    title: task.title,
    topic: task.topic,
    scheduled_date: task.scheduled_date,
    duration_minutes: String(task.duration_minutes),
  });

  async function submitEdit(event) {
    event.preventDefault();
    const saved = await onSave(task, {
      ...draft,
      duration_minutes: Number(draft.duration_minutes),
    });
    if (saved) setEditing(false);
  }

  return (
    <article className={`planner-task-card planner-task-${task.status}`}>
      <time className="planner-task-time" dateTime={`${task.scheduled_date}T${task.start_time}`}>
        <span>{formatTime(task.start_time)}</span>
        <small>{task.duration_minutes} min</small>
      </time>
      <div className="planner-task-content">
        <div className="planner-task-title-row">
          <strong>{task.title}</strong>
          <span className={`planner-task-status planner-status-${task.status}`}>
            {task.status}
          </span>
        </div>
        <p>
          {task.subject} · {task.topic} · {task.task_type}
        </p>
        {task.citations.length > 0 && (
          <small className="planner-task-citations">
            From {task.citations.map((citation) =>
              `${citation.source}, p. ${citation.page}`
            ).join("; ")}
          </small>
        )}
        {editing && (
          <form className="planner-task-edit" onSubmit={submitEdit}>
            <label>
              Activity
              <input
                maxLength={500}
                required
                value={draft.title}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    title: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Topic
              <input
                maxLength={300}
                required
                value={draft.topic}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    topic: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Date
              <input
                type="date"
                required
                value={draft.scheduled_date}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    scheduled_date: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Minutes
              <input
                type="number"
                min="5"
                max="120"
                required
                value={draft.duration_minutes}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    duration_minutes: event.target.value,
                  }))
                }
              />
            </label>
            <div className="planner-task-edit-actions">
              <button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save changes"}
              </button>
              <button type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        <div className="planner-task-actions">
          <button
            type="button"
            onClick={() => onComplete(task)}
            disabled={saving}
          >
            {task.completed ? "Mark pending" : "Mark complete"}
          </button>
          <button
            type="button"
            onClick={() => setEditing((previous) => !previous)}
            disabled={saving}
          >
            {editing ? "Close editor" : "Edit / reschedule"}
          </button>
          <button
            type="button"
            className="planner-delete-button"
            onClick={() => onDelete(task)}
            disabled={saving}
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

export default function StudyPlanner({ uploading, onFilesSelected }) {
  const [subjects, setSubjects] = useState(() => [createSubject()]);
  const [availableHours, setAvailableHours] = useState("2");
  const [startTime, setStartTime] = useState("09:00");
  const [sources, setSources] = useState([]);
  const [selectedSources, setSelectedSources] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [plans, setPlans] = useState([]);
  const [activePlanId, setActivePlanId] = useState("");
  const [plansLoading, setPlansLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingTaskId, setSavingTaskId] = useState("");
  const [view, setView] = useState("week");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let active = true;
    Promise.allSettled([listStudyPlannerSources(), listStudyPlans()]).then(
      ([sourcesResult, plansResult]) => {
        if (!active) return;
        if (sourcesResult.status === "fulfilled") {
          setSources(sourcesResult.value);
        } else {
          setError(sourcesResult.reason.message);
        }
        if (plansResult.status === "fulfilled") {
          setPlans(plansResult.value);
          setActivePlanId(plansResult.value[0]?.id || "");
        } else {
          setError(plansResult.reason.message);
        }
        setSourcesLoading(false);
        setPlansLoading(false);
      }
    );
    return () => {
      active = false;
    };
  }, []);

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === activePlanId) || plans[0] || null,
    [activePlanId, plans]
  );
  const today = localDateString(new Date());
  const weeklyEnd = addDays(today, 6);
  const todayTasks = (activePlan?.tasks || []).filter(
    (task) => task.scheduled_date === today
  );
  const weekTasks = (activePlan?.tasks || []).filter(
    (task) => task.scheduled_date >= today && task.scheduled_date <= weeklyEnd
  );
  const visibleTasks = (activePlan?.tasks || [])
    .filter((task) => {
      if (view === "today") return task.scheduled_date === today;
      if (view === "week") {
        return task.scheduled_date >= today && task.scheduled_date <= weeklyEnd;
      }
      return true;
    })
    .sort((first, second) =>
      `${first.scheduled_date}-${first.start_time}`.localeCompare(
        `${second.scheduled_date}-${second.start_time}`
      )
    );

  function updateSubject(subjectId, changes) {
    setSubjects((previous) =>
      previous.map((subject) =>
        subject.id === subjectId ? { ...subject, ...changes } : subject
      )
    );
  }

  function updateTopic(subjectId, topicId, changes) {
    setSubjects((previous) =>
      previous.map((subject) =>
        subject.id === subjectId
          ? {
              ...subject,
              topics: subject.topics.map((topic) =>
                topic.id === topicId ? { ...topic, ...changes } : topic
              ),
            }
          : subject
      )
    );
  }

  function addTopic(subjectId) {
    setSubjects((previous) =>
      previous.map((subject) =>
        subject.id === subjectId
          ? {
              ...subject,
              topics: [
                ...subject.topics,
                {
                  id: `${Date.now()}-${Math.random()}`,
                  name: "",
                  difficulty: "Medium",
                },
              ],
            }
          : subject
      )
    );
  }

  function removeTopic(subjectId, topicId) {
    setSubjects((previous) =>
      previous.map((subject) =>
        subject.id === subjectId && subject.topics.length > 1
          ? {
              ...subject,
              topics: subject.topics.filter((topic) => topic.id !== topicId),
            }
          : subject
      )
    );
  }

  async function refreshSources() {
    setSourcesLoading(true);
    try {
      const availableSources = await listStudyPlannerSources();
      setSources(availableSources);
      setSelectedSources((previous) =>
        previous.filter((source) => availableSources.includes(source))
      );
      setError("");
    } catch (sourceError) {
      setError(sourceError.message);
    } finally {
      setSourcesLoading(false);
    }
  }

  async function handlePdfSelection(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;
    await onFilesSelected(files);
    await refreshSources();
  }

  function toggleSource(source) {
    if (selectedSources.includes(source)) {
      setSelectedSources((previous) =>
        previous.filter((item) => item !== source)
      );
      return;
    }
    if (selectedSources.length >= 12) {
      setError("Select up to 12 lecture PDFs for one timetable.");
      return;
    }
    setSelectedSources((previous) => [...previous, source]);
  }

  async function handleGenerate(event) {
    event.preventDefault();
    setGenerating(true);
    setError("");
    setStatus("");
    try {
      const plan = await generateStudyPlan({
        subjects: subjects.map(({ subject, exam_date, topics: subjectTopics }) => ({
          subject,
          exam_date,
          topics: subjectTopics.map(({ name, difficulty }) => ({
            name,
            difficulty,
          })),
        })),
        available_hours: Number(availableHours),
        start_time: startTime,
        selected_sources: selectedSources,
      });
      setPlans((previous) => [plan, ...previous]);
      setActivePlanId(plan.id);
      setView("week");
      setStatus("Your AI-generated weekly study timetable has been saved.");
    } catch (generationError) {
      setError(generationError.message);
    } finally {
      setGenerating(false);
    }
  }

  async function saveTask(task, changes) {
    setSavingTaskId(task.id);
    setError("");
    setStatus("");
    try {
      const updatedTask = await updateStudyTask(task.id, changes);
      setPlans((previous) => updateTaskInPlans(previous, updatedTask));
      setStatus("Study task updated.");
      return true;
    } catch (taskError) {
      setError(taskError.message);
      return false;
    } finally {
      setSavingTaskId("");
    }
  }

  async function completeTask(task) {
    await saveTask(task, { completed: !task.completed });
  }

  async function removeTask(task) {
    setSavingTaskId(task.id);
    setError("");
    setStatus("");
    try {
      await deleteStudyTask(task.id);
      setPlans((previous) =>
        previous.map((plan) => ({
          ...plan,
          tasks: plan.tasks.filter((item) => item.id !== task.id),
        }))
      );
      setStatus("Study task deleted.");
    } catch (taskError) {
      setError(taskError.message);
    } finally {
      setSavingTaskId("");
    }
  }

  return (
    <section className="study-planner-panel">
      <header className="study-planner-heading">
        <p className="eyebrow">PLAN YOUR NEXT STUDY WEEK</p>
        <h1>AI Study Planner</h1>
        <p>
          Add your subjects, exam dates, and topic difficulty. Groq builds a
          realistic daily timetable with breaks and revision using your selected
          lecture PDFs.
        </p>
      </header>

      <form className="study-planner-form" onSubmit={handleGenerate}>
        <div className="planner-form-topline">
          <h2>Study goals</h2>
          <button
            type="button"
            className="planner-secondary-button"
            onClick={() => setSubjects((previous) => [...previous, createSubject()])}
            disabled={subjects.length >= 10}
          >
            Add subject
          </button>
        </div>

        {subjects.map((subject, subjectIndex) => (
          <fieldset className="planner-subject" key={subject.id}>
            <div className="planner-subject-heading">
              <legend>Subject {subjectIndex + 1}</legend>
              {subjects.length > 1 && (
                <button
                  type="button"
                  className="planner-text-button"
                  onClick={() =>
                    setSubjects((previous) =>
                      previous.filter((item) => item.id !== subject.id)
                    )
                  }
                >
                  Remove subject
                </button>
              )}
            </div>
            <div className="planner-subject-fields">
              <label>
                Subject name
                <input
                  maxLength={200}
                  required
                  value={subject.subject}
                  onChange={(event) =>
                    updateSubject(subject.id, { subject: event.target.value })
                  }
                  placeholder="e.g. Biology"
                />
              </label>
              <label>
                Exam date
                <input
                  type="date"
                  min={addDays(today, 1)}
                  required
                  value={subject.exam_date}
                  onChange={(event) =>
                    updateSubject(subject.id, { exam_date: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="planner-topics">
              <strong>Topics and difficulty</strong>
              {subject.topics.map((topic, topicIndex) => (
                <div className="planner-topic-row" key={topic.id}>
                  <label>
                    <span className="planner-visually-hidden">
                      Topic {topicIndex + 1}
                    </span>
                    <input
                      maxLength={300}
                      required
                      value={topic.name}
                      onChange={(event) =>
                        updateTopic(subject.id, topic.id, {
                          name: event.target.value,
                        })
                      }
                      placeholder="e.g. Cell division"
                    />
                  </label>
                  <label>
                    <span className="planner-visually-hidden">
                      Difficulty for {topic.name || `topic ${topicIndex + 1}`}
                    </span>
                    <select
                      value={topic.difficulty}
                      onChange={(event) =>
                        updateTopic(subject.id, topic.id, {
                          difficulty: event.target.value,
                        })
                      }
                    >
                      <option>Easy</option>
                      <option>Medium</option>
                      <option>Hard</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="planner-remove-topic"
                    onClick={() => removeTopic(subject.id, topic.id)}
                    disabled={subject.topics.length <= 1}
                    aria-label={`Remove ${topic.name || `topic ${topicIndex + 1}`}`}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="planner-text-button"
                onClick={() => addTopic(subject.id)}
                disabled={subject.topics.length >= 20}
              >
                Add topic
              </button>
            </div>
          </fieldset>
        ))}

        <div className="planner-settings-row">
          <label>
            Available study hours per day
            <input
              type="number"
              min="0.5"
              max="16"
              step="0.5"
              required
              value={availableHours}
              onChange={(event) => setAvailableHours(event.target.value)}
            />
          </label>
          <label>
            Daily start time
            <input
              type="time"
              required
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </label>
        </div>

        <fieldset className="planner-sources">
          <legend>Lecture PDFs (optional)</legend>
          <div className="planner-source-toolbar">
            <span>
              {sourcesLoading
                ? "Loading indexed PDFs..."
                : `${selectedSources.length} selected`}
            </span>
            <label className="planner-upload-button">
              {uploading ? "Uploading..." : "Upload PDFs"}
              <input
                type="file"
                accept=".pdf,application/pdf"
                multiple
                onChange={handlePdfSelection}
                disabled={uploading}
                aria-label="Upload lecture PDFs for the study planner"
              />
            </label>
          </div>
          {sources.length > 0 ? (
            <div className="planner-source-list">
              {sources.map((source) => (
                <label key={source}>
                  <input
                    type="checkbox"
                    checked={selectedSources.includes(source)}
                    onChange={() => toggleSource(source)}
                    disabled={
                      !selectedSources.includes(source) &&
                      selectedSources.length >= 12
                    }
                  />
                  <span>{source}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="planner-muted">
              Upload a lecture PDF to index it, then select it here as study
              material. You can also generate a plan from your topics alone.
            </p>
          )}
        </fieldset>

        <button
          className="planner-generate-button"
          type="submit"
          disabled={generating || plansLoading}
        >
          {generating ? "Building your timetable..." : "Generate weekly timetable"}
        </button>
        {generating && (
          <p className="planner-loading" role="status">
            Prioritizing upcoming exams and difficult topics...
          </p>
        )}
      </form>

      {error && <p className="planner-error" role="alert">{error}</p>}
      {status && <p className="planner-status" role="status">{status}</p>}

      {plansLoading ? (
        <p className="planner-muted" role="status">Loading saved study plans...</p>
      ) : activePlan ? (
        <section className="planner-saved-plan" aria-label="Saved study timetable">
          <div className="planner-saved-plan-heading">
            <div>
              <p className="eyebrow">SAVED IN YOUR STUDY DATABASE</p>
              <h2>Your timetable</h2>
            </div>
            {plans.length > 1 && (
              <label>
                Saved plans
                <select
                  value={activePlan.id}
                  onChange={(event) => setActivePlanId(event.target.value)}
                >
                  {plans.map((plan, index) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.subjects.map((subject) => subject.subject).join(", ")}{" "}
                      · Plan {plans.length - index}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="planner-progress-grid">
            <ProgressCard label="Today" progress={getProgress(todayTasks)} />
            <ProgressCard
              label="Weekly (next 7 days)"
              progress={getProgress(weekTasks)}
            />
          </div>

          <div className="planner-task-summary" aria-label="Task status counts">
            {["completed", "pending", "overdue"].map((taskStatus) => (
              <span key={taskStatus}>
                <strong>
                  {activePlan.tasks.filter((task) => task.status === taskStatus).length}
                </strong>{" "}
                {taskStatus}
              </span>
            ))}
          </div>

          <div className="planner-task-toolbar">
            <div role="tablist" aria-label="Timetable view">
              {[
                ["today", "Today"],
                ["week", "This week"],
                ["all", "All tasks"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={view === value}
                  className={view === value ? "active" : ""}
                  onClick={() => setView(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span>
              {activePlan.available_hours} hours/day · starts{" "}
              {formatTime(activePlan.start_time)}
            </span>
          </div>

          {visibleTasks.length > 0 ? (
            <div className="planner-task-list">
              {visibleTasks.map((task) => (
                <div className="planner-task-row" key={task.id}>
                  {view !== "today" && (
                    <time className="planner-task-date" dateTime={task.scheduled_date}>
                      {new Date(`${task.scheduled_date}T12:00:00`).toLocaleDateString(
                        undefined,
                        { weekday: "short", month: "short", day: "numeric" }
                      )}
                    </time>
                  )}
                  <StudyTaskCard
                    key={`${task.id}-${task.title}-${task.scheduled_date}-${task.duration_minutes}-${task.completed}`}
                    task={task}
                    onComplete={completeTask}
                    onDelete={removeTask}
                    onSave={saveTask}
                    saving={savingTaskId === task.id}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="planner-muted">
              No tasks are scheduled in this view. Try another timetable view.
            </p>
          )}
        </section>
      ) : (
        <p className="planner-muted">
          No saved plans yet. Add your subjects and generate your first timetable.
        </p>
      )}
    </section>
  );
}
