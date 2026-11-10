import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  saveConversationMessage,
} from "../src/chatHistoryApi.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("chat history API helpers call list, load, create, save, rename, and delete routes", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ conversations: [], id: "chat/1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await listConversations();
  await getConversation("chat/1");
  await createConversation({ id: "chat/1", title: "Test", messages: [] });
  await saveConversationMessage("chat/1", { role: "user", content: "Hi" });
  await renameConversation("chat/1", "Renamed");
  await deleteConversation("chat/1");

  assert.deepEqual(
    calls.map(({ options }) => options.method || "GET"),
    ["GET", "GET", "POST", "POST", "PATCH", "DELETE"]
  );
  assert.match(calls[1].url, /chat%2F1$/);
  assert.equal(JSON.parse(calls[2].options.body).title, "Test");
  assert.equal(JSON.parse(calls[3].options.body).content, "Hi");
  assert.equal(JSON.parse(calls[4].options.body).title, "Renamed");
});

test("chat history API surfaces database errors and connection failures", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ detail: "Chat history database is unavailable." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  await assert.rejects(listConversations, /database is unavailable/);

  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(listConversations, /Could not connect to chat history/);
});
