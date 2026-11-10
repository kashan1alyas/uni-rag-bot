import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { createServer } from "vite";

class TestLocalStorage {
  values = new Map();

  get length() {
    return this.values.size;
  }

  key(index) {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

globalThis.window = {
  indexedDB,
  IDBKeyRange,
  localStorage: new TestLocalStorage(),
  navigator: {
    storage: {
      estimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    },
  },
};

let server;
let history;

before(async () => {
  const legacyRequest = indexedDB.open("uniassist-chat-history", 2);
  const legacyDb = await new Promise((resolve, reject) => {
    legacyRequest.onupgradeneeded = () => {
      legacyRequest.result.createObjectStore("chats", { keyPath: "id" });
      legacyRequest.result.createObjectStore("meta");
    };
    legacyRequest.onsuccess = () => resolve(legacyRequest.result);
    legacyRequest.onerror = () => reject(legacyRequest.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = legacyDb.transaction("chats", "readwrite");
    transaction.objectStore("chats").put({
      id: "existing-chat",
      title: "Existing conversation",
      messages: [
        {
          role: "user",
          content: "Keep this message after upgrading.",
          timestamp: 1,
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    });
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
  legacyDb.close();

  server = await createServer({
    configFile: "./vite.config.js",
    server: { middlewareMode: true },
    appType: "custom",
  });
  history = await server.ssrLoadModule("/src/App.jsx");
});

after(async () => {
  if (server) await server.close();
});

test("migrates, repeatedly saves, reloads, and deletes chats without losing messages", async () => {
  const firstLoad = await history.readChatHistory();
  assert.equal(firstLoad.migrationError, null);
  assert.equal(firstLoad.chats.length, 1);
  assert.equal(
    firstLoad.chats[0].messages[0].content,
    "Keep this message after upgrading."
  );

  const [firstConnection, secondConnection] = await Promise.all([
    history.openChatHistoryDb(),
    history.openChatHistoryDb(),
  ]);
  assert.strictEqual(firstConnection, secondConnection);

  const messageCount = 120;
  const largeContent = "A large saved response. ".repeat(1_200);
  const writes = Array.from({ length: messageCount }, (_, index) =>
    history.saveChatMessage("existing-chat", {
      role: index % 2 === 0 ? "user" : "assistant",
      content: `${index}: ${largeContent}`,
      sources: [{ filename: "lecture.pdf", page: index + 1 }],
      timestamp: index + 2,
    })
  );
  await Promise.all(writes);
  await assert.rejects(
    history.saveChatMessage("existing-chat", {
      role: "assistant",
      content: "This value cannot be cloned.",
      invalid: () => {},
    })
  );

  const connection = await history.openChatHistoryDb();
  const messageStorePrototype = Object.getPrototypeOf(
    connection
      .transaction("messages", "readwrite")
      .objectStore("messages")
  );
  const originalPut = messageStorePrototype.put;
  messageStorePrototype.put = () => {
    throw new DOMException("Simulated storage limit.", "QuotaExceededError");
  };
  try {
    await assert.rejects(
      history.saveChatMessage("existing-chat", {
        role: "assistant",
        content: "This write exceeds the storage quota.",
      }),
      { name: "QuotaExceededError" }
    );
  } finally {
    messageStorePrototype.put = originalPut;
  }

  const newChat = {
    id: "new-chat",
    title: "New chat",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await history.createChatHistory(newChat);
  await history.saveChatMessage("new-chat", {
    role: "user",
    content: "First question",
    timestamp: Date.now(),
  });

  firstConnection.onversionchange(new Event("versionchange"));
  const afterReload = await history.readChatHistory();
  assert.equal(afterReload.chats.length, 2);
  const largeChat = afterReload.chats.find((chat) => chat.id === "existing-chat");
  assert.equal(largeChat.messages.length, messageCount + 1);
  assert.match(largeChat.messages[messageCount].content, /^119: /);
  assert.equal(largeChat.messages[messageCount].sources[0].filename, "lecture.pdf");

  await history.deleteChatHistory("new-chat");
  const afterDelete = await history.readChatHistory();
  assert.deepEqual(afterDelete.chats.map((chat) => chat.id), ["existing-chat"]);
  assert.equal(afterDelete.chats[0].messages.length, messageCount + 1);
});
