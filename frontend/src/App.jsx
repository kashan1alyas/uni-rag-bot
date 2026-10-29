
import { useRef, useState } from "react";
import "./App.css";

const API_URL = "http://127.0.0.1:8000/api/chat";
const UPLOAD_URL = "http://127.0.0.1:8000/api/upload";
const ASSIGNMENT_URL = "http://127.0.0.1:8000/api/assignment";
const ASSIGNMENT_PDF_URL = "http://127.0.0.1:8000/api/assignment/pdf";
const MAX_PDF_SIZE = 20 * 1024 * 1024;
const MAX_LOGO_SIZE = 3 * 1024 * 1024;

const suggestions = [
  {
    title: "Understand machine learning",
    question: "What is machine learning? Explain it with examples.",
    icon: "🧠",
  },
  {
    title: "Learn gradient descent",
    question: "What is gradient descent in linear regression?",
    icon: "📈",
  },
  {
    title: "Explore deep learning",
    question: "Explain artificial neural networks in simple words.",
    icon: "💡",
  },
  {
    title: "Review linear algebra",
    question: "What is a matrix and why is it important in AI?",
    icon: "📚",
  },
];

function App() {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploads, setUploads] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [assignmentDraft, setAssignmentDraft] = useState("");
  const [assignmentSources, setAssignmentSources] = useState([]);
  const [copyMessage, setCopyMessage] = useState("");
  const [pdfExporting, setPdfExporting] = useState(false);
  const [coverError, setCoverError] = useState("");
  const [cover, setCover] = useState({
    university_name: "",
    student_name: "",
    teacher_name: "",
    registration_number: "",
    subject_name: "",
    logo_data_url: "",
  });
  const logoInputRef = useRef(null);
  const [assignment, setAssignment] = useState({
    subject: "",
    topic: "",
    word_count: 1000,
    format: "Essay",
    deadline: "",
    assignment_question: "",
    instructions: "",
    requirements: "",
  });

  async function sendMessage(text = question) {
    const cleanQuestion = text.trim();

    if (!cleanQuestion || loading) return;

    setMessages((previous) => [
      ...previous,
      { role: "user", content: cleanQuestion },
    ]);
    setQuestion("");
    setError("");
    setLoading(true);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: cleanQuestion }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "The server could not answer your question."
        );
      }

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: data.answer || "No answer was returned.",
          sources: (data.sources || []).map((source) => ({
            filename: source.filename || source.source || "Unknown PDF",
            page: source.page ?? "Unknown",
          })),
        },
      ]);
    } catch (err) {
      setError(
        err.message === "Failed to fetch"
          ? "Cannot connect to the backend. Make sure FastAPI is running at http://127.0.0.1:8000."
          : err.message || "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    sendMessage();
  }

  function updateAssignment(event) {
    const { name, value } = event.target;
    setAssignment((previous) => ({
      ...previous,
      [name]: name === "word_count" ? Number(value) : value,
    }));
  }

  function updateCover(event) {
    const { name, value } = event.target;
    setCover((previous) => ({ ...previous, [name]: value }));
  }

  function handleLogoSelection(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setCoverError("");

    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setCoverError("Choose a PNG or JPEG university logo.");
      return;
    }
    if (file.size > MAX_LOGO_SIZE) {
      setCoverError("The university logo must be 3 MB or smaller.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setCoverError("The university logo could not be read.");
        return;
      }
      setCover((previous) => ({
        ...previous,
        logo_data_url: reader.result,
      }));
    };
    reader.onerror = () => {
      setCoverError("The university logo could not be read.");
    };
    reader.readAsDataURL(file);
  }

  async function generateAssignment(event) {
    event.preventDefault();
    setAssignmentLoading(true);
    setAssignmentError("");
    setCopyMessage("");
    setAssignmentDraft("");
    setAssignmentSources([]);

    try {
      const response = await fetch(ASSIGNMENT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assignment),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "The assignment draft could not be generated."
        );
      }

      setAssignmentDraft(data.draft || "");
      setAssignmentSources(data.sources || []);
    } catch (generationError) {
      setAssignmentError(
        generationError instanceof Error &&
          generationError.message !== "Failed to fetch"
          ? generationError.message
          : "Could not connect to the assignment service. Make sure FastAPI is running."
      );
    } finally {
      setAssignmentLoading(false);
    }
  }

  async function copyAssignmentDraft() {
    try {
      await navigator.clipboard.writeText(assignmentDraft);
      setCopyMessage("Draft copied to clipboard.");
      setAssignmentError("");
    } catch {
      setAssignmentError(
        "Could not copy the draft. Select the text and copy it manually."
      );
    }
  }

  async function downloadAssignmentPdf() {
    setPdfExporting(true);
    setAssignmentError("");
    setCopyMessage("");

    try {
      const response = await fetch(ASSIGNMENT_PDF_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...cover,
          topic: assignment.topic,
          draft: assignmentDraft,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          data.detail || "The assignment PDF could not be created."
        );
      }

      const pdf = await response.blob();
      const downloadUrl = URL.createObjectURL(pdf);
      const link = document.createElement("a");
      const safeSubject = (cover.subject_name || assignment.subject || "assignment")
        .replace(/[<>:"/\\|?*]+/g, "-")
        .trim();
      link.href = downloadUrl;
      link.download = `${safeSubject || "assignment"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setCopyMessage("Assignment PDF downloaded.");
    } catch (exportError) {
      setAssignmentError(
        exportError instanceof Error &&
          exportError.message !== "Failed to fetch"
          ? exportError.message
          : "Could not connect to the PDF export service. Make sure FastAPI is running."
      );
    } finally {
      setPdfExporting(false);
    }
  }

  async function handleFileSelection(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";

    if (files.length === 0 || uploading) return;

    setUploading(true);
    setError("");

    const selectedUploads = files.map((file, index) => {
      let uploadError = "";
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        uploadError = "Only PDF files can be uploaded.";
      } else if (file.size > MAX_PDF_SIZE) {
        uploadError = "This file is larger than the 20 MB limit.";
      } else if (file.size === 0) {
        uploadError = "This file is empty.";
      }

      return {
        id: `${Date.now()}-${index}-${file.name}`,
        file,
        status: uploadError ? "Failed" : "Uploading",
        error: uploadError,
      };
    });

    setUploads((previous) => [...selectedUploads, ...previous]);

    try {
      for (const upload of selectedUploads) {
        if (upload.error) continue;

        try {
          const formData = new FormData();
          formData.append("file", upload.file);
          const response = await fetch(UPLOAD_URL, {
            method: "POST",
            body: formData,
          });
          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(
              data.detail || `Upload failed with status ${response.status}.`
            );
          }

          setUploads((previous) =>
            previous.map((item) =>
              item.id === upload.id
                ? { ...item, status: "Indexed", error: "" }
                : item
            )
          );
        } catch (uploadError) {
          const message =
            uploadError instanceof Error &&
            uploadError.message !== "Failed to fetch"
              ? uploadError.message
              : "Could not connect to the upload service. Make sure FastAPI is running.";

          setUploads((previous) =>
            previous.map((item) =>
              item.id === upload.id
                ? { ...item, status: "Failed", error: message }
                : item
            )
          );
        }
      }
    } finally {
      setUploading(false);
    }
  }

  function handleNewChat() {
    setMessages([]);
    setQuestion("");
    setError("");
    setLoading(false);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">U</div>
          <div>
            <h2>UniAssist</h2>
            <span>University AI Assistant</span>
          </div>
        </div>

        <button className="new-chat-button" onClick={handleNewChat}>
          <span>＋</span> New chat
        </button>

        <div className="sidebar-label">YOUR STUDY ASSISTANT</div>

        <div className="sidebar-note">
          <span className="status-dot" />
          <div>
            <strong>Lecture Notes</strong>
            <p>Ask questions from your PDFs</p>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="footer-avatar">AI</div>
          <div>
            <strong>Study smarter</strong>
            <p>Powered by RAG + Groq</p>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <span className="mobile-brand">UniAssist</span>
            <span className="topbar-subtitle">
              Your personal university study companion
            </span>
          </div>
          <div className="online-status">
            <span className="status-dot" />
            AI Assistant
          </div>
          <button
            className="assignment-toggle"
            type="button"
            onClick={() => setAssignmentOpen((open) => !open)}
          >
            {assignmentOpen ? "Back to Chat" : "Assignment Assistant"}
          </button>
        </header>

        <section className="chat-area">
          {assignmentOpen ? (
            <div className="assignment-panel">
              <div className="assignment-heading">
                <p className="eyebrow">PLAN AND DRAFT</p>
                <h1>Assignment Assistant</h1>
                <p>
                  Share the prompt and requirements. UniAssist will use relevant
                  uploaded course documents to prepare a draft for you to review.
                </p>
              </div>

              <form className="assignment-form" onSubmit={generateAssignment}>
                <label>
                  Subject
                  <input
                    name="subject"
                    value={assignment.subject}
                    onChange={updateAssignment}
                    maxLength={200}
                    required
                    placeholder="e.g. Introduction to Machine Learning"
                  />
                </label>
                <label>
                  Topic
                  <input
                    name="topic"
                    value={assignment.topic}
                    onChange={updateAssignment}
                    maxLength={300}
                    required
                    placeholder="e.g. Logistic regression"
                  />
                </label>
                <label>
                  Word count
                  <input
                    name="word_count"
                    type="number"
                    min="100"
                    max="5000"
                    value={assignment.word_count}
                    onChange={updateAssignment}
                    required
                  />
                </label>
                <label>
                  Format
                  <select
                    name="format"
                    value={assignment.format}
                    onChange={updateAssignment}
                    required
                  >
                    <option>Essay</option>
                    <option>Report</option>
                    <option>Research paper</option>
                    <option>Lab report</option>
                    <option>Presentation outline</option>
                    <option>Other</option>
                  </select>
                </label>
                <label>
                  Deadline (optional)
                  <input
                    name="deadline"
                    type="date"
                    value={assignment.deadline}
                    onChange={updateAssignment}
                  />
                </label>
                <label className="assignment-field-wide">
                  Assignment question
                  <textarea
                    name="assignment_question"
                    value={assignment.assignment_question}
                    onChange={updateAssignment}
                    maxLength={5000}
                    required
                    rows={3}
                    placeholder="Paste the question or describe what you need to answer."
                  />
                </label>
                <label className="assignment-field-wide">
                  Instructions
                  <textarea
                    name="instructions"
                    value={assignment.instructions}
                    onChange={updateAssignment}
                    maxLength={10000}
                    required
                    rows={4}
                    placeholder="Include the assignment instructions from your course."
                  />
                </label>
                <label className="assignment-field-wide">
                  Requirements
                  <textarea
                    name="requirements"
                    value={assignment.requirements}
                    onChange={updateAssignment}
                    maxLength={10000}
                    required
                    rows={3}
                    placeholder="List required sections, rubric criteria, and other constraints."
                  />
                </label>
                <fieldset className="cover-fields assignment-field-wide">
                  <legend>PDF cover page</legend>
                  <label>
                    University name
                    <input
                      name="university_name"
                      value={cover.university_name}
                      onChange={updateCover}
                      maxLength={200}
                      placeholder="University name"
                    />
                  </label>
                  <label>
                    Subject name
                    <input
                      name="subject_name"
                      value={cover.subject_name}
                      onChange={updateCover}
                      maxLength={200}
                      placeholder="Course or subject"
                    />
                  </label>
                  <label>
                    Student name
                    <input
                      name="student_name"
                      value={cover.student_name}
                      onChange={updateCover}
                      maxLength={200}
                      placeholder="Student name"
                    />
                  </label>
                  <label>
                    Teacher name
                    <input
                      name="teacher_name"
                      value={cover.teacher_name}
                      onChange={updateCover}
                      maxLength={200}
                      placeholder="Instructor name"
                    />
                  </label>
                  <label>
                    Registration number
                    <input
                      name="registration_number"
                      value={cover.registration_number}
                      onChange={updateCover}
                      maxLength={100}
                      placeholder="Student registration number"
                    />
                  </label>
                  <label className="logo-upload-field">
                    University logo (PNG or JPEG, max 3 MB)
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg"
                      onChange={handleLogoSelection}
                    />
                  </label>
                  {cover.logo_data_url && (
                    <div className="logo-preview">
                      <img src={cover.logo_data_url} alt="University logo preview" />
                      <button
                        type="button"
                        className="remove-logo-button"
                        onClick={() =>
                          setCover((previous) => ({
                            ...previous,
                            logo_data_url: "",
                          }))
                        }
                      >
                        Remove logo
                      </button>
                    </div>
                  )}
                  {coverError && (
                    <p className="cover-error" role="alert">{coverError}</p>
                  )}
                </fieldset>
                <button
                  className="assignment-generate"
                  type="submit"
                  disabled={assignmentLoading}
                >
                  {assignmentLoading ? "Preparing your draft..." : "Generate draft"}
                </button>
              </form>

              {assignmentLoading && (
                <p className="assignment-status" role="status">
                  Reviewing your instructions and relevant course documents...
                </p>
              )}
              {assignmentError && (
                <div className="error-message" role="alert">
                  <span>⚠</span> {assignmentError}
                </div>
              )}

              {assignmentDraft && (
                <section className="assignment-result">
                  <div className="assignment-result-heading">
                    <div>
                      <h2>Draft</h2>
                      <p>Review and edit this draft before using it.</p>
                    </div>
                    <div className="assignment-actions">
                      <button
                        type="button"
                        className="copy-draft-button"
                        onClick={copyAssignmentDraft}
                      >
                        Copy draft
                      </button>
                      <button
                        type="button"
                        className="download-pdf-button"
                        onClick={downloadAssignmentPdf}
                        disabled={pdfExporting}
                      >
                        {pdfExporting ? "Creating PDF..." : "Download PDF"}
                      </button>
                    </div>
                  </div>
                  <div className="cover-preview">
                    <div className="cover-preview-brand">
                      {cover.logo_data_url && (
                        <img src={cover.logo_data_url} alt="" />
                      )}
                      <strong>{cover.university_name || "University name"}</strong>
                    </div>
                    <span>ASSIGNMENT</span>
                    <h3>{assignment.topic || "Assignment topic"}</h3>
                    <p>{cover.subject_name || assignment.subject || "Subject name"}</p>
                    <p>
                      {cover.student_name || "Student name"}
                      {cover.registration_number
                        ? ` · ${cover.registration_number}`
                        : ""}
                    </p>
                    <p>{cover.teacher_name || "Teacher name"}</p>
                  </div>
                  {copyMessage && (
                    <p className="assignment-status" role="status">
                      {copyMessage}
                    </p>
                  )}
                  <textarea
                    className="assignment-draft"
                    aria-label="Generated assignment draft"
                    value={assignmentDraft}
                    onChange={(event) => {
                      setAssignmentDraft(event.target.value);
                      setCopyMessage("");
                    }}
                  />
                  {assignmentSources.length > 0 && (
                    <div className="sources-panel">
                      <strong>📚 Sources from your course documents</strong>
                      <div className="source-list">
                        {assignmentSources.map((source, index) => (
                          <div
                            className="source-item"
                            key={`${source.source}-${source.page}-${index}`}
                          >
                            <span className="source-file">PDF</span>
                            <span className="source-name">{source.source}</span>
                            <span className="source-page">
                              Page {source.page}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}
            </div>
          ) : (
            <>
          {messages.length === 0 ? (
            <div className="welcome-screen">
              <div className="welcome-icon">✦</div>
              <p className="eyebrow">YOUR CAMPUS, YOUR KNOWLEDGE</p>
              <h1>What would you like to <span>learn today?</span></h1>
              <p className="welcome-description">
                Ask questions about your university lecture notes.
                Get clear explanations grounded in your study materials.
              </p>

              <div className="suggestion-grid">
                {suggestions.map((item) => (
                  <button
                    className="suggestion-card"
                    key={item.title}
                    onClick={() => sendMessage(item.question)}
                    disabled={loading}
                  >
                    <span className="suggestion-icon">{item.icon}</span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.question}</small>
                    </span>
                    <span className="suggestion-arrow">↗</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages-list">
              {messages.map((message, index) => (
                <article
                  className={`message message-${message.role}`}
                  key={`${index}-${message.role}`}
                >
                  <div className="message-avatar">
                    {message.role === "user" ? "You" : "U"}
                  </div>

                  <div className="message-body">
                    <div className="message-author">
                      {message.role === "user" ? "You" : "UniAssist"}
                    </div>
                    <div className="message-content">
                      {message.content}
                    </div>

                    {message.sources?.length > 0 && (
                      <div className="sources-panel">
                        <strong>📚 Sources from your lecture notes</strong>
                        <div className="source-list">
                          {message.sources.map((source, sourceIndex) => (
                            <div
                              className="source-item"
                              key={`${source.filename}-${source.page}-${sourceIndex}`}
                            >
                              <span className="source-file">PDF</span>
                              <span className="source-name">
                                {source.filename}
                              </span>
                              <span className="source-page">
                                Page {source.page}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              ))}

              {loading && (
                <div className="message message-assistant">
                  <div className="message-avatar">U</div>
                  <div className="message-body">
                    <div className="message-author">UniAssist</div>
                    <div className="typing-indicator">
                      <span />
                      <span />
                      <span />
                      <small>Reading your notes and preparing an answer…</small>
                    </div>
                  </div>
                </div>
              )}

              <div className="messages-bottom" />
            </div>
          )}

          {error && (
            <div className="error-message" role="alert">
              <span>⚠</span> {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
            </>
          )}
        </section>

        {!assignmentOpen && <footer className="composer-area">
          <form className="composer" onSubmit={handleSubmit}>
            <input
              ref={fileInputRef}
              className="file-input"
              type="file"
              accept=".pdf,application/pdf"
              multiple
              onChange={handleFileSelection}
              aria-label="Select PDF files to upload"
            />
            <button
              className="attach-button"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-label="Attach PDF files"
              title="Attach PDF files"
            >
              📎
            </button>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask anything about your lecture notes..."
              rows={1}
              maxLength={2000}
              disabled={loading}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  handleSubmit(event);
                }
              }}
            />

            <button
              className="send-button"
              type="submit"
              disabled={!question.trim() || loading}
              aria-label="Send message"
              title="Send message"
            >
              {loading ? "…" : "↑"}
            </button>
          </form>

          {uploads.length > 0 && (
            <div className="upload-list" aria-live="polite">
              {uploads.map((upload) => (
                <div
                  className={`upload-item upload-${upload.status.toLowerCase()}`}
                  key={upload.id}
                >
                  <span className="upload-filename">{upload.file.name}</span>
                  <span className="upload-status">{upload.status}</span>
                  {upload.error && (
                    <span className="upload-error" role="alert">
                      {upload.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="composer-hint">
            AI can make mistakes. Verify important details with your lecture notes.
            <span> Enter to send · Shift + Enter for a new line</span>
          </p>
        </footer>}
      </main>
    </div>
  );
}

export default App;
