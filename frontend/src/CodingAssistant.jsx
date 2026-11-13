
import { useState, useRef, useCallback } from "react";
import { generateCode } from "./codingApi";
import "./CodingAssistant.css";

// Language badge
function CodeLanguageBadge({ language }) {
  const languages = {
    python: "PY",
    cpp: "CPP",
    java: "JAVA",
    javascript: "JS",
  };

  return (
    <span className="code-language-badge">
      {languages[language] || language?.toUpperCase() || "CODE"}
    </span>
  );
}

// Download helper
function downloadCode(code, language) {
  if (!code) return;

  const extensions = {
    python: "py",
    cpp: "cpp",
    java: "java",
    javascript: "js",
  };

  const extension = extensions[language] || "txt";
  const blob = new Blob([code], {
    type: "text/plain;charset=utf-8",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `generated_code.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

// Code result
function CodeResultSection({ code, language, title }) {
  if (!code?.trim()) return null;

  return (
    <section className="code-result-section">
      <div className="code-result-header">
        <h3>{title}</h3>

        <CodeLanguageBadge language={language} />

        <button
          type="button"
          className="code-action-button"
          onClick={() =>
            navigator.clipboard.writeText(code).catch(() => {})
          }
          title="Copy code"
        >
          📋
        </button>

        <button
          type="button"
          className="code-action-button"
          onClick={() => downloadCode(code, language)}
          title="Download code"
        >
          ⬇️
        </button>
      </div>

      <div className="code-result-content">
        <pre className="code-preview">
          <code className={`language-${language}`}>{code}</code>
        </pre>
      </div>
    </section>
  );
}

// Explanation result
function CodeExplanationSection({ codeLines }) {
  if (!codeLines?.length) return null;

  return (
    <section className="code-explanation-section">
      <h3>Line-by-Line Explanation</h3>

      <div className="code-explanations">
        {codeLines.map((line, index) => (
          <div
            key={line.line ?? index}
            className="code-explanation-item"
          >
            <div className="code-explanation-line">
              <span className="code-explanation-number">
                Line {line.line ?? index + 1}:
              </span>

              <span className="code-explanation-content">
                {line.content}
              </span>
            </div>

            <p className="code-explanation-desc">
              {line.explanation}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// Fix result
function CodeFixSection({ fixedCode, explanation, language }) {
  if (!fixedCode?.trim()) return null;

  return (
    <section className="code-fix-section">
      <h3>Fixed Code</h3>

      <pre className="code-preview">
        <code>{fixedCode}</code>
      </pre>

      <p className="code-fix-explanation">{explanation}</p>

      <button
        type="button"
        className="code-action-button"
        onClick={() => downloadCode(fixedCode, language)}
      >
        Download Fixed Code
      </button>
    </section>
  );
}

// Optimization result
function CodeOptimizationSection({
  optimizedCode,
  explanation,
  language,
}) {
  if (!optimizedCode?.trim()) return null;

  return (
    <section className="code-optimization-section">
      <h3>Optimized Code</h3>

      <pre className="code-preview">
        <code>{optimizedCode}</code>
      </pre>

      <p className="code-optimization-explanation">
        {explanation}
      </p>

      <button
        type="button"
        className="code-action-button"
        onClick={() => downloadCode(optimizedCode, language)}
      >
        Download Optimized Code
      </button>
    </section>
  );
}

// Conversion result
function CodeConversionSection({
  convertedCode,
  fromLanguage,
  toLanguage,
}) {
  if (!convertedCode?.trim()) return null;

  return (
    <section className="code-conversion-section">
      <h3>Converted Code</h3>

      <p className="code-conversion-info">
        {fromLanguage} → {toLanguage}
      </p>

      <pre className="code-preview">
        <code>{convertedCode}</code>
      </pre>
    </section>
  );
}

// Practice question
function PracticeQuestionSection({ practiceQuestion }) {
  if (!practiceQuestion) return null;

  const {
    question,
    question_type,
    options = [],
    correct_answer,
    explanation,
  } = practiceQuestion;

  return (
    <section className="practice-question-section">
      <h3>Coding Practice Question</h3>

      <p className="practice-question-text">{question}</p>

      {question_type === "mcq" && (
        <div className="practice-options">
          {options.map((option, index) => (
            <label
              key={index}
              className="practice-option-label"
            >
              <input
                type="radio"
                name="practice-answer"
                value={option}
                className="practice-option-input"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      )}

      {question_type === "true_false" && (
        <div className="practice-true-false">
          {["True", "False"].map((option) => (
            <label
              key={option}
              className="practice-true-false-label"
            >
              <input
                type="radio"
                name="practice-answer"
                value={option}
                className="practice-option-input"
              />
              {option}
            </label>
          ))}
        </div>
      )}

      {question_type === "short_answer" && (
        <p className="practice-short-answer">
          <strong>Model Answer:</strong> {correct_answer}
        </p>
      )}

      <p className="practice-explanation">{explanation}</p>
    </section>
  );
}

// File upload
function CodeUploadSection({
  acceptedFiles,
  inputRef,
  onFileSelected,
  onRemoveFile,
}) {
  return (
    <div className="code-upload-section">
      <p className="code-upload-hint">
        Or upload a code file
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".py,.cpp,.java,.js"
        multiple
        onChange={onFileSelected}
        className="code-file-input"
        style={{ display: "none" }}
      />

      <button
        type="button"
        className="code-upload-button"
        onClick={() => inputRef.current?.click()}
      >
        Upload Code File
      </button>

      <div className="code-uploaded-files">
        {acceptedFiles.map((file, index) => (
          <span
            key={`${file.name}-${index}`}
            className="code-uploaded-file"
          >
            {file.name}

            <button
              type="button"
              className="code-remove-file"
              onClick={() => onRemoveFile(index)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

// Main component
export default function CodingAssistant({
  sources,
  sourcesLoading,
  uploading,
  onFilesSelected,
}) {
  const [view, setView] = useState("generate");
  const [language, setLanguage] = useState("python");
  const [instruction, setInstruction] = useState("");
  const [code, setCode] = useState("");

  const [explanationCodeLines, setExplanationCodeLines] =
    useState([]);

  const [fixedCode, setFixedCode] = useState("");
  const [fixExplanation, setFixExplanation] = useState("");

  const [optimizedCode, setOptimizedCode] = useState("");
  const [optExplanation, setOptExplanation] = useState("");

  const [convertedCode, setConvertedCode] = useState("");
  const [fromLang, setFromLang] = useState("python");
  const [toLang, setToLang] = useState("java");

  const [practiceQuestion, setPracticeQuestion] = useState(null);
  const [acceptedFiles, setAcceptedFiles] = useState([]);

  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [generating, setGenerating] = useState(false);

  const fileInputRef = useRef(null);

  const supportedLanguages = [
    { value: "python", label: "Python" },
    { value: "cpp", label: "C++" },
    { value: "java", label: "Java" },
    { value: "javascript", label: "JavaScript" },
  ];

  const supportedTasks = [
    { value: "generate", label: "Generate Code" },
    { value: "explain", label: "Explain Code" },
    { value: "fix", label: "Fix / Debug Code" },
    { value: "optimize", label: "Optimize / Improve Code" },
    { value: "convert", label: "Convert Code" },
    { value: "practice", label: "Generate Practice Question" },
  ];

  const handleTaskChange = (event) => {
    setView(event.target.value);

    setInstruction("");
    setCode("");
    setExplanationCodeLines([]);
    setFixedCode("");
    setFixExplanation("");
    setOptimizedCode("");
    setOptExplanation("");
    setConvertedCode("");
    setFromLang("python");
    setToLang("java");
    setPracticeQuestion(null);

    setError("");
    setStatus("");
  };

  const handleCodeChange = useCallback((event) => {
    setCode(event.target.value);
    setStatus("");
  }, []);

  const handleFileChange = (event) => {
    const selectedFiles = Array.from(
      event.target.files || []
    );

    const validFiles = selectedFiles.filter((file) => {
      const validExtension =
        /\.(py|cpp|java|js)$/i.test(file.name);

      return (
        validExtension &&
        file.size <= 5 * 1024 * 1024
      );
    });

    if (validFiles.length !== selectedFiles.length) {
      setError(
        "Some files were rejected. Only .py, .cpp, .java and .js files up to 5 MB are allowed."
      );
    } else {
      setError("");
    }

    setAcceptedFiles(validFiles);

    if (onFilesSelected && validFiles.length > 0) {
      onFilesSelected(validFiles);
    }

    event.target.value = "";
  };

  const handleRemoveFile = (index) => {
    const updatedFiles = acceptedFiles.filter(
      (_, fileIndex) => fileIndex !== index
    );

    setAcceptedFiles(updatedFiles);

    if (onFilesSelected) {
      onFilesSelected(updatedFiles);
    }
  };

  const handleGenerate = async () => {
    if (!instruction.trim()) {
      setError("Please enter an instruction.");
      return;
    }

    if (
      ["explain", "fix", "optimize", "convert"].includes(view) &&
      !code.trim()
    ) {
      setError("Please enter or upload code first.");
      return;
    }

    setGenerating(true);
    setError("");
    setStatus("");

    try {
      const result = await generateCode({
        language,
        code: code || "",
        instruction: instruction.trim(),
        task: view,
        target_language:
          view === "convert" ? toLang : undefined,
      });

      if (!result) {
        throw new Error("The AI returned an empty response.");
      }

      switch (view) {
        case "generate":
          setCode(result.generated_code || "");
          break;

        case "explain":
          setExplanationCodeLines(
            (result.code_lines || []).map((line, index) => ({
              line: line.line ?? index + 1,
              content: line.content || "",
              explanation: line.explanation || "",
            }))
          );
          break;

        case "fix":
          setFixedCode(result.fixed_code || "");
          setFixExplanation(result.explanation || "");
          break;

        case "optimize":
          setOptimizedCode(result.optimized_code || "");
          setOptExplanation(result.explanation || "");
          break;

        case "convert":
          setConvertedCode(result.converted_code || "");
          setFromLang(result.from_language || language);
          setToLang(result.to_language || toLang);
          break;

        case "practice":
          setPracticeQuestion(result.practice_question || null);
          break;

        default:
          throw new Error("Unsupported coding task.");
      }

      setStatus("Response generated successfully.");
    } catch (err) {
      setError(
        err.message || "Failed to generate code. Please try again."
      );

      console.error("Coding assistant error:", err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="coding-assistant-panel">
      <header className="coding-assistant-heading">
        <p className="coding-assistant-eyebrow">
          AI CODING ASSISTANT
        </p>

        <h1>UniAssist Coding</h1>

        <p>
          Generate, explain, fix, optimize, and convert code using Groq AI.
        </p>
      </header>

      <form
        className="coding-assistant-form"
        onSubmit={(event) => {
          event.preventDefault();
          handleGenerate();
        }}
      >
        <div className="coding-assistant-panel-top">
          <div className="coding-assistant-task-selector">
            <strong>Task</strong>

            <select
              value={view}
              onChange={handleTaskChange}
              disabled={generating}
            >
              {supportedTasks.map((task) => (
                <option key={task.value} value={task.value}>
                  {task.label}
                </option>
              ))}
            </select>
          </div>

          <div className="coding-assistant-language-selector">
            <strong>Language</strong>

            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              disabled={generating}
            >
              {supportedLanguages.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="coding-assistant-instruction">
          <strong>Instruction</strong>

          <textarea
            value={instruction}
            onChange={(event) =>
              setInstruction(event.target.value)
            }
            placeholder="e.g., Create a Python function that sorts a list using bubble sort..."
            rows={4}
            disabled={generating}
            required
          />
        </div>

        <div className="coding-assistant-code-input">
          <strong>Existing Code (Optional)</strong>

          <textarea
            value={code}
            onChange={handleCodeChange}
            placeholder="Paste your code here to be processed..."
            rows={6}
            disabled={generating}
          />
        </div>

        {view === "convert" && (
          <div className="coding-assistant-language-selector">
            <strong>Convert To</strong>

            <select
              value={toLang}
              onChange={(event) => setToLang(event.target.value)}
              disabled={generating}
            >
              {supportedLanguages.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="submit"
          className="coding-assistant-generate-button"
          disabled={
            generating ||
            !instruction.trim() ||
            sourcesLoading ||
            uploading
          }
        >
          {generating ? "Processing..." : "Generate Response"}
        </button>
      </form>

      {error && (
        <div className="coding-assistant-error" role="alert">
          <span>⚠</span> {error}
        </div>
      )}

      {status && (
        <div className="coding-assistant-status" role="status">
          {status}
        </div>
      )}

      {/* Code Results */}

      {view === "generate" && (
        <CodeResultSection
          code={code}
          language={language}
          title="Generated Code"
        />
      )}

      {view === "explain" && (
        <CodeExplanationSection
          codeLines={explanationCodeLines}
        />
      )}

      {view === "fix" && (
        <CodeFixSection
          fixedCode={fixedCode}
          explanation={fixExplanation}
          language={language}
        />
      )}

      {view === "optimize" && (
        <CodeOptimizationSection
          optimizedCode={optimizedCode}
          explanation={optExplanation}
          language={language}
        />
      )}

      {view === "convert" && (
        <CodeConversionSection
          convertedCode={convertedCode}
          fromLanguage={fromLang}
          toLanguage={toLang}
        />
      )}

      {view === "practice" && (
        <PracticeQuestionSection
          practiceQuestion={practiceQuestion}
        />
      )}

      {/* Code Upload */}

      <CodeUploadSection
        acceptedFiles={acceptedFiles}
        inputRef={fileInputRef}
        onFileSelected={handleFileChange}
        onRemoveFile={handleRemoveFile}
      />
    </section>
  );
}
