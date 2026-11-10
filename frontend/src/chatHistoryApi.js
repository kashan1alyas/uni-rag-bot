const CONVERSATIONS_URL = "http://127.0.0.1:8000/api/conversations";

async function request(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(
      "Could not connect to chat history. Make sure FastAPI is running.",
      { cause: error }
    );
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item) => item.msg).join("; ")
      : data.detail;
    throw new Error(
      detail || `Chat history request failed (${response.status}).`
    );
  }
  return data;
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function listConversations() {
  const data = await request(CONVERSATIONS_URL);
  return data.conversations;
}

export function getConversation(conversationId) {
  return request(`${CONVERSATIONS_URL}/${encodeURIComponent(conversationId)}`);
}

export function createConversation(conversation) {
  return request(
    CONVERSATIONS_URL,
    jsonOptions("POST", conversation)
  );
}

export function saveConversationMessage(conversationId, message) {
  return request(
    `${CONVERSATIONS_URL}/${encodeURIComponent(conversationId)}/messages`,
    jsonOptions("POST", message)
  );
}

export function renameConversation(conversationId, title) {
  return request(
    `${CONVERSATIONS_URL}/${encodeURIComponent(conversationId)}`,
    jsonOptions("PATCH", { title })
  );
}

export function deleteConversation(conversationId) {
  return request(
    `${CONVERSATIONS_URL}/${encodeURIComponent(conversationId)}`,
    { method: "DELETE" }
  );
}
