
import { useState } from "react";

function App() {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function testConnection() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/api/test"
      );

      if (!response.ok) {
        throw new Error("Backend returned an error.");
      }

      const data = await response.json();
      setMessage(data.message);
    } catch {
      setError(
        "Could not connect. Make sure FastAPI is running."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: "40px", fontFamily: "Arial" }}>
      <h1>Your University RAG Chatbot</h1>
      <p>React frontend + FastAPI backend</p>

      <button onClick={testConnection} disabled={loading}>
        {loading ? "Connecting..." : "Test Backend Connection"}
      </button>

      {message && <p style={{ color: "green" }}>{message}</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
    </main>
  );
}

export default App;
