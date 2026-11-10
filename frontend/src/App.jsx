
import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import ChatMarkdown from "./ChatMarkdown";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  saveConversationMessage,
} from "./chatHistoryApi";
import {
  downloadNotesPdf,
  generateNotes,
  listNotesSources,
} from "./notesApi";
import { generateQuiz, listQuizSources } from "./quizApi";
import { isQuizAnswerCorrect, scoreQuiz } from "./quizScoring";
import {
  generateExamPlan,
  generateExamPractice as createExamPractice,
  listExamSources,
} from "./examApi";
import {
  getWeakExamTopics,
  scoreExamPractice,
} from "./examScoring";
import {
  downloadPresentationPptx,
  generatePresentation,
  listPresentationSources,
} from "./presentationApi";
import {
  downloadResearchDocx,
  downloadResearchPdf,
  generateResearch,
  listResearchSources,
} from "./researchApi";
import { uploadPdf } from "./uploadApi";

const API_URL = "http://127.0.0.1:8000/api/chat";
const SUGGESTIONS_URL = "http://127.0.0.1:8000/api/suggestions";
const ASSIGNMENT_URL = "http://127.0.0.1:8000/api/assignment";
const ASSIGNMENT_PDF_URL = "http://127.0.0.1:8000/api/assignment/pdf";
const MAX_PDF_SIZE = 20 * 1024 * 1024;
const SUGGESTIONS_STORAGE_KEY = "uniassist-study-suggestions";
const SUGGESTION_ICONS = ["🧠", "📈", "💡", "📚"];
const MAX_LOGO_SIZE = 3 * 1024 * 1024;
const COVER_TEXT_STORAGE_KEY = "uniassist-cover-details";
const COVER_DEFAULTS_DB = "uniassist-cover-defaults";
const COVER_DEFAULTS_STORE = "defaults";
const CHAT_HISTORY_DB = "uniassist-chat-history";
const CHAT_HISTORY_DB_VERSION = 3;
const CHAT_HISTORY_STORE = "chats";
const CHAT_HISTORY_META_STORE = "meta";
const CHAT_HISTORY_MIGRATION_KEY = "legacy-store-migrated";
const CHAT_MESSAGE_STORE = "messages";
const CHAT_MESSAGE_MIGRATION_KEY = "messages-normalized-v1";
const LEGACY_CHAT_STORAGE_KEYS = [
  "uniassist-chat-history",
  "uniassist-chats",
  "chat-history",
  "chat_history",
  "chatHistory",
  "chats",
];
const COVER_LOGO_KEY = "logo";
const LEGACY_COVER_DEFAULTS_KEY = "cover";
const COVER_TEXT_FIELDS = [
  "university_name",
  "student_name",
  "teacher_name",
  "registration_number",
];

let chatHistoryDbPromise = null;
let chatHistoryMigrationPromise = null;
let chatHistoryPreparedPromise = null;
let chatHistoryWriteQueue = Promise.resolve();

function createChatId() {
  return window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function logStorageFailure(operation, error, db = null, storeNames = []) {
  let cause =
    error instanceof Error ? error : new Error(String(error || "Unknown error"));
  if (cause.name === "QuotaExceededError") {
    cause = new Error(
      `${cause.message || "Browser storage quota exceeded."} Free browser storage space and try again.`,
      { cause }
    );
    cause.name = "QuotaExceededError";
  }
  console.error("[UniAssist] Browser storage operation failed", {
    operation,
    database: db?.name || null,
    databaseVersion: db?.version ?? null,
    availableObjectStores: db ? Array.from(db.objectStoreNames) : [],
    requestedObjectStores: storeNames,
    errorName: cause.name,
    errorMessage: cause.message,
    error,
  });
  if (
    ["QuotaExceededError", "UnknownError"].includes(cause.name) &&
    typeof window !== "undefined" &&
    window.navigator?.storage?.estimate
  ) {
    window.navigator.storage
      .estimate()
      .then(({ usage, quota }) => {
        console.error("[UniAssist] Browser storage estimate after failure", {
          usage,
          quota,
          operation,
        });
      })
      .catch((estimateError) => {
        console.warn("[UniAssist] Browser storage estimate unavailable", {
          operation,
          error: estimateError,
        });
      });
  }
  return cause;
}

function describeStorageFailure(error) {
  if (error instanceof Error) {
    const message = error.message || "(no error message provided)";
    if (error.name === "QuotaExceededError" && !/quota/i.test(message)) {
      return `${error.name}: ${message} Free browser storage space and try again.`;
    }
    return `${error.name}: ${message}`;
  }
  return String(error || "Unknown browser storage error.");
}

function requireObjectStores(db, storeNames, operation) {
  const missingStores = storeNames.filter(
    (storeName) => !db.objectStoreNames.contains(storeName)
  );
  if (missingStores.length === 0) return;

  throw logStorageFailure(
    `${operation}: validate object stores`,
    new Error(
      `Database "${db.name}" version ${db.version} is missing required object store(s): ${missingStores.join(", ")}. Available stores: ${Array.from(db.objectStoreNames).join(", ") || "(none)"}.`
    ),
    db,
    storeNames
  );
}

function writeChatRecord(store, chat, operation) {
  if (store.keyPath === null) {
    return operation === "add"
      ? store.add(chat, chat.id)
      : store.put(chat, chat.id);
  }
  if (store.keyPath !== "id") {
    throw new Error(
      `The "${CHAT_HISTORY_STORE}" store has unsupported keyPath "${store.keyPath}". Expected "id" or no keyPath.`
    );
  }
  return operation === "add" ? store.add(chat) : store.put(chat);
}

function openCoverDefaultsDb() {
  function openDatabase(version) {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(
          logStorageFailure(
            "open cover defaults database",
            new Error("IndexedDB is unavailable in this browser.")
          )
        );
        return;
      }

      let request;
      try {
        request =
          version === undefined
            ? window.indexedDB.open(COVER_DEFAULTS_DB)
            : window.indexedDB.open(COVER_DEFAULTS_DB, version);
      } catch (error) {
        reject(logStorageFailure("open cover defaults database", error));
        return;
      }
      let blocked = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(COVER_DEFAULTS_STORE)) {
          request.result.createObjectStore(COVER_DEFAULTS_STORE);
        }
        if (!request.result.objectStoreNames.contains(CHAT_HISTORY_STORE)) {
          request.result.createObjectStore(CHAT_HISTORY_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        if (!db.objectStoreNames.contains(COVER_DEFAULTS_STORE)) {
          const nextVersion = Math.max(3, db.version + 1);
          db.close();
          openDatabase(nextVersion).then(resolve, reject);
          return;
        }
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () =>
        reject(
          logStorageFailure(
            "open cover defaults database",
            request.error || new Error("Could not open saved details.")
          )
        );
      request.onblocked = () => {
        blocked = true;
        reject(
          logStorageFailure(
            "upgrade cover defaults database",
            new Error("The saved details database is blocked by another tab.")
          )
        );
      };
    });
  }

  return openDatabase();
}

function openChatHistoryDb() {
  if (chatHistoryDbPromise) return chatHistoryDbPromise;

  function openDatabase(version) {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(
          logStorageFailure(
            "open chat history database",
            new Error("IndexedDB is unavailable in this browser.")
          )
        );
        return;
      }

      let request;
      try {
        request =
          version === undefined
            ? window.indexedDB.open(CHAT_HISTORY_DB)
            : window.indexedDB.open(CHAT_HISTORY_DB, version);
      } catch (error) {
        reject(logStorageFailure("open chat history database", error));
        return;
      }
      let blocked = false;
      request.onupgradeneeded = () => {
        console.info("[UniAssist] Upgrading chat history database", {
          fromVersion: request.oldVersion,
          toVersion: request.newVersion,
          existingObjectStores: Array.from(request.transaction.db.objectStoreNames),
        });
        if (!request.result.objectStoreNames.contains(CHAT_HISTORY_STORE)) {
          request.result.createObjectStore(CHAT_HISTORY_STORE, {
            keyPath: "id",
          });
        }
        if (!request.result.objectStoreNames.contains(CHAT_HISTORY_META_STORE)) {
          request.result.createObjectStore(CHAT_HISTORY_META_STORE);
        }
        if (!request.result.objectStoreNames.contains(CHAT_MESSAGE_STORE)) {
          request.result.createObjectStore(CHAT_MESSAGE_STORE, {
            keyPath: ["chatId", "index"],
          });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }

        const missingStores = [
          CHAT_HISTORY_STORE,
          CHAT_HISTORY_META_STORE,
          CHAT_MESSAGE_STORE,
        ].filter((storeName) => !db.objectStoreNames.contains(storeName));
        if (missingStores.length > 0) {
          const nextVersion = Math.max(
            CHAT_HISTORY_DB_VERSION,
            db.version + 1
          );
          console.warn("[UniAssist] Repairing incomplete chat history schema", {
            database: db.name,
            databaseVersion: db.version,
            missingObjectStores: missingStores,
            availableObjectStores: Array.from(db.objectStoreNames),
            targetVersion: nextVersion,
          });
          db.close();
          openDatabase(nextVersion).then(resolve, reject);
          return;
        }

        db.onversionchange = () => {
          db.close();
          if (chatHistoryDbPromise === openingPromise) {
            chatHistoryDbPromise = null;
            chatHistoryPreparedPromise = null;
          }
        };
        db.onclose = () => {
          if (chatHistoryDbPromise === openingPromise) {
            chatHistoryDbPromise = null;
            chatHistoryPreparedPromise = null;
          }
        };
        resolve(db);
      };
      request.onerror = () =>
        reject(
          logStorageFailure(
            "open chat history database",
            request.error || new Error("Could not open chat history.")
          )
        );
      request.onblocked = () => {
        blocked = true;
        reject(
          logStorageFailure(
            "upgrade chat history database",
            new Error("The chat history database is blocked by another tab.")
          )
        );
      };
    });
  }

  const openingPromise = openDatabase()
    .catch((error) => {
      chatHistoryDbPromise = null;
      throw error;
    });
  chatHistoryDbPromise = openingPromise;
  return openingPromise;
}

function queueChatHistoryWrite(operation) {
  const result = chatHistoryWriteQueue.then(operation, operation);
  chatHistoryWriteQueue = result.catch(() => {});
  return result;
}

function prepareChatHistory(db) {
  if (chatHistoryPreparedPromise) return chatHistoryPreparedPromise;

  chatHistoryPreparedPromise = (async () => {
    let migrationError = null;
    try {
      await migrateLegacyChatHistory(db);
    } catch (error) {
      migrationError = error;
    }
    await migrateEmbeddedChatMessages(db);
    return migrationError;
  })().catch((error) => {
    chatHistoryPreparedPromise = null;
    throw error;
  });
  return chatHistoryPreparedPromise;
}

function runChatHistoryTransaction(db, storeNames, mode, operation, action) {
  return new Promise((resolve, reject) => {
    let transaction;
    let result;
    let failure = null;
    const fail = (error, stage) => {
      if (failure) return;
      failure = logStorageFailure(
        `${operation}: ${stage}`,
        error || new Error("The browser could not complete this operation."),
        db,
        storeNames
      );
      if (transaction) {
        try {
          transaction.abort();
        } catch {
          reject(failure);
        }
      } else {
        reject(failure);
      }
    };

    try {
      requireObjectStores(db, storeNames, operation);
      transaction = db.transaction(storeNames, mode);
      transaction.oncomplete = () => {
        if (failure) {
          reject(failure);
        } else {
          resolve(result);
        }
      };
      transaction.onerror = () => {
        if (!failure) {
          failure = logStorageFailure(
            `${operation}: transaction`,
            transaction.error || new Error("The browser could not complete this operation."),
            db,
            storeNames
          );
        }
      };
      transaction.onabort = () =>
        reject(
          failure ||
            logStorageFailure(
              `${operation}: transaction abort`,
              transaction.error || new Error("The browser canceled this operation."),
              db,
              storeNames
            )
        );
      action(transaction, (value) => {
        result = value;
      }, fail);
    } catch (error) {
      fail(error, "create transaction");
    }
  });
}

function extractLegacyChats(value, fallbackId) {
  if (Array.isArray(value)) {
    const records = value.filter(
      (item) => item && typeof item === "object" && Array.isArray(item.messages)
    );
    if (records.length > 0) return records;
    if (
      value.some(
        (item) =>
          item &&
          typeof item === "object" &&
          ["user", "assistant"].includes(item.role) &&
          typeof item.content === "string"
      )
    ) {
      return [{ id: fallbackId, messages: value }];
    }
    return [];
  }

  if (!value || typeof value !== "object") return [];
  for (const key of ["chats", "conversations", "history"]) {
    if (Array.isArray(value[key])) {
      const chats = extractLegacyChats(value[key], fallbackId);
      if (chats.length > 0) return chats;
    }
  }

  if (Array.isArray(value.messages)) return [{ ...value, id: value.id || fallbackId }];

  return Object.entries(value)
    .filter(([, chat]) => chat && typeof chat === "object" && Array.isArray(chat.messages))
    .map(([id, chat]) => ({ ...chat, id: chat.id || id }));
}

function readLocalStorageChats() {
  const keys = new Set(LEGACY_CHAT_STORAGE_KEYS);
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key && /(chat|conversation|history)/i.test(key)) keys.add(key);
  }

  const chatsById = new Map();
  for (const key of keys) {
    let serialized;
    try {
      serialized = window.localStorage.getItem(key);
    } catch (error) {
      throw logStorageFailure(
        `read localStorage key "${key}" for legacy conversations`,
        error
      );
    }
    if (!serialized) continue;

    let parsed;
    try {
      parsed = JSON.parse(serialized);
    } catch (error) {
      throw logStorageFailure(
        `parse localStorage key "${key}" for legacy conversations`,
        new Error(
          `Saved conversations in localStorage key "${key}" are invalid JSON.`,
          { cause: error }
        )
      );
    }

    for (const [index, legacyChat] of extractLegacyChats(parsed, key).entries()) {
      const chat = normalizeChat({
        ...legacyChat,
        id: String(legacyChat.id || `${key}-${index}`),
      });
      if (chat) chatsById.set(chat.id, chat);
    }
  }
  return [...chatsById.values()];
}

/*
 * Old database versions may have been created before both chat stores existed.
 * Open without a version first, then upgrade only if the schema is incomplete.
 */
function readLegacyChatHistory() {
  return new Promise((resolve, reject) => {
    if (typeof window.indexedDB.databases === "function") {
      window.indexedDB.databases().then((databases) => {
        if (!databases.some((database) => database.name === COVER_DEFAULTS_DB)) {
          resolve([]);
          return;
        }
        openLegacyDatabase(resolve, reject);
      }, (error) => reject(logStorageFailure("list legacy databases", error)));
      return;
    }

    openLegacyDatabase(resolve, reject);
  });
}

function openLegacyDatabase(resolve, reject) {
  const request = window.indexedDB.open(COVER_DEFAULTS_DB);
  request.onerror = () =>
    reject(
      logStorageFailure(
        "open legacy chat database",
        request.error || new Error("Could not open existing chats.")
      )
    );
  request.onsuccess = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(CHAT_HISTORY_STORE)) {
      db.close();
      resolve([]);
      return;
    }

    let transaction;
    let legacyChats = [];
    try {
      requireObjectStores(db, [CHAT_HISTORY_STORE], "read legacy chats");
      transaction = db.transaction(CHAT_HISTORY_STORE, "readonly");
      const getAllRequest = transaction
        .objectStore(CHAT_HISTORY_STORE)
        .getAll();
      getAllRequest.onsuccess = () => {
        legacyChats = getAllRequest.result;
      };
      getAllRequest.onerror = () => {
        db.close();
        reject(
          logStorageFailure(
            "read legacy chats: objectStore.getAll",
            getAllRequest.error || new Error("Could not read existing chats."),
            db,
            [CHAT_HISTORY_STORE]
          )
        );
      };
    } catch (error) {
      db.close();
      reject(logStorageFailure("read legacy chats: create transaction", error, db, [CHAT_HISTORY_STORE]));
      return;
    }

    transaction.oncomplete = () => {
      db.close();
      resolve(legacyChats);
    };
    transaction.onerror = () => {
      db.close();
      reject(
        logStorageFailure(
          "read legacy chats: transaction",
          transaction.error || new Error("Could not read existing chats."),
          db,
          [CHAT_HISTORY_STORE]
        )
      );
    };
    transaction.onabort = () => {
      db.close();
      reject(
        logStorageFailure(
          "read legacy chats: transaction abort",
          transaction.error || new Error("Could not read existing chats."),
          db,
          [CHAT_HISTORY_STORE]
        )
      );
    };
  };
}

function normalizeChat(chat) {
  if (
    !chat ||
    (typeof chat.id !== "string" && typeof chat.id !== "number") ||
    !Array.isArray(chat.messages)
  ) {
    return null;
  }

  const toTimestamp = (value, fallback) => {
    if (Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  };
  const updatedAt =
    toTimestamp(chat.updatedAt, Date.now());
  const messages = chat.messages
    .filter(
      (message) =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string"
    )
    .map((message) => ({
      ...message,
      timestamp: toTimestamp(message.timestamp, updatedAt),
    }));
  const firstUserMessage = messages.find((message) => message.role === "user");

  return {
    id: String(chat.id),
    title:
      typeof chat.title === "string" && chat.title
        ? chat.title
        : firstUserMessage?.content || "New chat",
    messages,
    createdAt: toTimestamp(chat.createdAt, updatedAt),
    updatedAt,
  };
}

function migrateLegacyChatHistory(db) {
  if (chatHistoryMigrationPromise) return chatHistoryMigrationPromise;
  chatHistoryMigrationPromise = migrateLegacyChatHistoryRecords(db).finally(() => {
    chatHistoryMigrationPromise = null;
  });
  return chatHistoryMigrationPromise;
}

async function migrateLegacyChatHistoryRecords(db) {
  const migrationComplete = await new Promise((resolve, reject) => {
    let transaction;
    let completed = false;
    try {
      requireObjectStores(
        db,
        [CHAT_HISTORY_META_STORE],
        "check migration marker"
      );
      transaction = db.transaction(CHAT_HISTORY_META_STORE, "readonly");
      const request = transaction
        .objectStore(CHAT_HISTORY_META_STORE)
        .get(CHAT_HISTORY_MIGRATION_KEY);
      request.onsuccess = () => {
        completed = Boolean(request.result);
      };
      request.onerror = () =>
        reject(
          logStorageFailure(
            "check migration marker: objectStore.get",
            request.error || new Error("Could not check chat migration."),
            db,
            [CHAT_HISTORY_META_STORE]
          )
        );
      transaction.oncomplete = () => resolve(completed);
      transaction.onerror = () =>
        reject(
          logStorageFailure(
            "check migration marker: transaction",
            transaction.error || new Error("Could not check chat migration."),
            db,
            [CHAT_HISTORY_META_STORE]
          )
        );
      transaction.onabort = () =>
        reject(
          logStorageFailure(
            "check migration marker: transaction abort",
            transaction.error || new Error("Could not check chat migration."),
            db,
            [CHAT_HISTORY_META_STORE]
          )
        );
    } catch (error) {
      reject(
        logStorageFailure(
          "check migration marker: create transaction",
          error,
          db,
          [CHAT_HISTORY_META_STORE]
        )
      );
    }
  });
  if (migrationComplete) return;

  const migrationErrors = [];
  let legacyChats = [];
  let localStorageChats = [];
  try {
    legacyChats = await readLegacyChatHistory();
  } catch (error) {
    logStorageFailure("read legacy IndexedDB conversations", error);
    migrationErrors.push(error);
  }
  try {
    localStorageChats = readLocalStorageChats();
  } catch (error) {
    logStorageFailure("read legacy localStorage conversations", error);
    migrationErrors.push(error);
  }

  await new Promise((resolve, reject) => {
    let transaction;
    let migrationWriteError = null;
    try {
      requireObjectStores(
        db,
        [CHAT_HISTORY_STORE, CHAT_HISTORY_META_STORE, CHAT_MESSAGE_STORE],
        "migrate legacy conversations"
      );
      transaction = db.transaction(
        [CHAT_HISTORY_STORE, CHAT_HISTORY_META_STORE, CHAT_MESSAGE_STORE],
        "readwrite"
      );
      const store = transaction.objectStore(CHAT_HISTORY_STORE);
      const messageStore = transaction.objectStore(CHAT_MESSAGE_STORE);
      for (const legacyChat of [...legacyChats, ...localStorageChats]) {
        const chat = normalizeChat(legacyChat);
        if (!chat) continue;
        const request = store.get(chat.id);
        request.onerror = () => {
          migrationWriteError = logStorageFailure(
            "migrate legacy conversations: chats.get",
            request.error || new Error("Could not read an existing conversation."),
            db,
            [CHAT_HISTORY_STORE, CHAT_HISTORY_META_STORE, CHAT_MESSAGE_STORE]
          );
          transaction.abort();
        };
        request.onsuccess = () => {
          if (request.result) return;
          try {
            const { messages, ...record } = chat;
            record.messageCount = messages.length;
            writeChatRecord(store, record);
            messages.forEach((message, index) => {
              messageStore.put({
                chatId: chat.id,
                index,
                message,
              });
            });
          } catch (error) {
            migrationWriteError = logStorageFailure(
              "migrate legacy conversations: chats.put",
              error,
              db,
              [CHAT_HISTORY_STORE, CHAT_HISTORY_META_STORE, CHAT_MESSAGE_STORE]
            );
            transaction.abort();
          }
        };
      }
      if (migrationErrors.length === 0) {
        try {
          transaction
            .objectStore(CHAT_HISTORY_META_STORE)
            .put(true, CHAT_HISTORY_MIGRATION_KEY);
        } catch (error) {
          migrationWriteError = logStorageFailure(
            "migrate legacy conversations: migration marker put",
            error,
            db,
            [CHAT_HISTORY_STORE, CHAT_HISTORY_META_STORE, CHAT_MESSAGE_STORE]
          );
          transaction.abort();
        }
      }
    } catch (error) {
      reject(
        logStorageFailure(
          "migrate legacy conversations: create transaction",
          error,
          db,
          [CHAT_HISTORY_STORE, CHAT_HISTORY_META_STORE, CHAT_MESSAGE_STORE]
        )
      );
      return;
    }

    transaction.oncomplete = resolve;
    transaction.onerror = () => {
      if (!migrationWriteError) {
        migrationWriteError = logStorageFailure(
          "migrate legacy conversations: transaction",
          transaction.error || new Error("Could not migrate existing chats."),
          db,
          [CHAT_HISTORY_STORE, CHAT_HISTORY_META_STORE, CHAT_MESSAGE_STORE]
        );
      }
    };
    transaction.onabort = () =>
      reject(
        migrationWriteError ||
          logStorageFailure(
            "migrate legacy conversations: transaction abort",
            transaction.error || new Error("Could not migrate existing chats."),
            db,
            [CHAT_HISTORY_STORE, CHAT_HISTORY_META_STORE, CHAT_MESSAGE_STORE]
          )
      );
  });

  if (migrationErrors.length > 0) {
    throw logStorageFailure(
      "migrate legacy conversations: read source",
      new Error(
        `Some existing conversations could not be migrated: ${migrationErrors
          .map((error) => error.message || String(error))
          .join("; ")}`,
        { cause: migrationErrors[0] }
      ),
      db,
      [CHAT_HISTORY_STORE, CHAT_HISTORY_META_STORE]
    );
  }
}

function migrateEmbeddedChatMessages(db) {
  return new Promise((resolve, reject) => {
    let transaction;
    let migrationError = null;
    try {
      requireObjectStores(
        db,
        [CHAT_HISTORY_STORE, CHAT_HISTORY_META_STORE, CHAT_MESSAGE_STORE],
        "normalize saved conversations"
      );
      transaction = db.transaction(
        [CHAT_HISTORY_STORE, CHAT_HISTORY_META_STORE, CHAT_MESSAGE_STORE],
        "readwrite"
      );
      const chats = transaction.objectStore(CHAT_HISTORY_STORE);
      const messages = transaction.objectStore(CHAT_MESSAGE_STORE);
      const meta = transaction.objectStore(CHAT_HISTORY_META_STORE);
      const markerRequest = meta.get(CHAT_MESSAGE_MIGRATION_KEY);

      markerRequest.onsuccess = () => {
        if (markerRequest.result) return;

        const chatsRequest = chats.getAll();
        chatsRequest.onerror = () => {
          migrationError = logStorageFailure(
            "normalize saved conversations: chats.getAll",
            chatsRequest.error || new Error("Could not read saved conversations."),
            db,
            [CHAT_HISTORY_STORE, CHAT_HISTORY_META_STORE, CHAT_MESSAGE_STORE]
          );
          transaction.abort();
        };
        chatsRequest.onsuccess = () => {
          for (const chat of chatsRequest.result) {
            if (!Array.isArray(chat.messages)) continue;

            const { messages: chatMessages, ...record } = chat;
            record.messageCount = chatMessages.length;
            try {
              writeChatRecord(chats, record);
              chatMessages.forEach((message, index) => {
                messages.put({
                  chatId: String(chat.id),
                  index,
                  message,
                });
              });
            } catch (error) {
              migrationError = logStorageFailure(
                "normalize saved conversations: write messages",
                error,
                db,
                [CHAT_HISTORY_STORE, CHAT_HISTORY_META_STORE, CHAT_MESSAGE_STORE]
              );
              transaction.abort();
              return;
            }
          }
          meta.put(true, CHAT_MESSAGE_MIGRATION_KEY);
        };
      };
      markerRequest.onerror = () => {
        migrationError = logStorageFailure(
          "normalize saved conversations: read migration marker",
          markerRequest.error || new Error("Could not check the migration state."),
          db,
          [CHAT_HISTORY_STORE, CHAT_HISTORY_META_STORE, CHAT_MESSAGE_STORE]
        );
        transaction.abort();
      };
    } catch (error) {
      reject(
        logStorageFailure(
          "normalize saved conversations: create transaction",
          error,
          db,
          [CHAT_HISTORY_STORE, CHAT_HISTORY_META_STORE, CHAT_MESSAGE_STORE]
        )
      );
      return;
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      if (!migrationError) {
        migrationError = logStorageFailure(
          "normalize saved conversations: transaction",
          transaction.error || new Error("Could not normalize saved conversations."),
          db,
          [CHAT_HISTORY_STORE, CHAT_HISTORY_META_STORE, CHAT_MESSAGE_STORE]
        );
      }
    };
    transaction.onabort = () =>
      reject(
        migrationError ||
          logStorageFailure(
            "normalize saved conversations: transaction abort",
            transaction.error || new Error("Could not normalize saved conversations."),
            db,
            [CHAT_HISTORY_STORE, CHAT_HISTORY_META_STORE, CHAT_MESSAGE_STORE]
          )
      );
  });
}

function readCoverTextDefaults() {
  const saved = window.localStorage.getItem(COVER_TEXT_STORAGE_KEY);
  if (saved === null) return null;

  const parsed = JSON.parse(saved);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Saved cover text details are invalid.");
  }

  return Object.fromEntries(
    COVER_TEXT_FIELDS.map((field) => [
      field,
      typeof parsed[field] === "string" ? parsed[field] : "",
    ])
  );
}

function dataUrlToBlob(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+=*)$/.exec(
    dataUrl
  );
  if (!match) {
    throw new Error("The saved university logo is not a valid PNG or JPEG.");
  }

  const binary = window.atob(match[2]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const blob = new Blob([bytes], { type: match[1] });
  if (blob.size > MAX_LOGO_SIZE) {
    throw new Error("The university logo must be 3 MB or smaller.");
  }
  return blob;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("The saved university logo could not be read."));
      }
    };
    reader.onerror = () =>
      reject(reader.error || new Error("The saved university logo could not be read."));
    reader.readAsDataURL(blob);
  });
}

function updateCoverDefaultsStore(update) {
  return openCoverDefaultsDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        let transaction;
        try {
          transaction = db.transaction(COVER_DEFAULTS_STORE, "readwrite");
          update(transaction.objectStore(COVER_DEFAULTS_STORE));
        } catch (error) {
          db.close();
          reject(error);
          return;
        }

        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error || new Error("Browser storage failed."));
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error || new Error("Browser storage failed."));
        };
      })
  );
}

function readChatHistory() {
  return openChatHistoryDb().then(async (db) => {
    const migrationError = await prepareChatHistory(db);
    const chats = await runChatHistoryTransaction(
      db,
      [CHAT_HISTORY_STORE, CHAT_MESSAGE_STORE],
      "readonly",
      "load chat history",
      (transaction, setResult, fail) => {
        let savedChats = [];
        let chatRecords;
        let messageRecords;
        let completedReads = 0;
        const collectResults = () => {
          completedReads += 1;
          if (completedReads !== 2) return;

          const messagesByChat = new Map();
          for (const record of messageRecords) {
            if (!messagesByChat.has(record.chatId)) {
              messagesByChat.set(record.chatId, []);
            }
            messagesByChat.get(record.chatId).push(record);
          }

          savedChats = chatRecords
            .map((record) => {
              const messages = (messagesByChat.get(String(record.id)) || [])
                .sort((left, right) => left.index - right.index)
                .map((item) => item.message);
              return normalizeChat({ ...record, messages });
            })
            .filter(Boolean)
            .sort((left, right) => right.updatedAt - left.updatedAt);
          setResult(savedChats);
        };

        const chatRequest = transaction
          .objectStore(CHAT_HISTORY_STORE)
          .getAll();
        chatRequest.onsuccess = () => {
          chatRecords = chatRequest.result;
          collectResults();
        };
        chatRequest.onerror = () =>
          fail(
            chatRequest.error || new Error("Could not read saved conversations."),
            "read conversations"
          );

        const messageRequest = transaction
          .objectStore(CHAT_MESSAGE_STORE)
          .getAll();
        messageRequest.onsuccess = () => {
          messageRecords = messageRequest.result;
          collectResults();
        };
        messageRequest.onerror = () =>
          fail(
            messageRequest.error || new Error("Could not read saved messages."),
            "read messages"
          );
      }
    );
    return { chats, migrationError };
  });
}

function createChatHistory(chat) {
  return queueChatHistoryWrite(async () => {
    const db = await openChatHistoryDb();
    await prepareChatHistory(db);
    const record = { ...chat, messageCount: 0 };
    delete record.messages;
    return runChatHistoryTransaction(
      db,
      [CHAT_HISTORY_STORE],
      "readwrite",
      "create chat",
      (transaction, setResult) => {
        writeChatRecord(
          transaction.objectStore(CHAT_HISTORY_STORE),
          record,
          "add"
        );
        setResult(chat);
      }
    );
  });
}

function saveChatMessage(chatId, message) {
  return queueChatHistoryWrite(async () => {
    const db = await openChatHistoryDb();
    await prepareChatHistory(db);
    return runChatHistoryTransaction(
      db,
      [CHAT_HISTORY_STORE, CHAT_MESSAGE_STORE],
      "readwrite",
      "save chat message",
      (transaction, setResult, fail) => {
        const chats = transaction.objectStore(CHAT_HISTORY_STORE);
        const messages = transaction.objectStore(CHAT_MESSAGE_STORE);
        const request = chats.get(chatId);
        request.onerror = () =>
          fail(
            request.error || new Error("Could not read chat before saving."),
            "read conversation"
          );
        request.onsuccess = () => {
          const existing = request.result;
          if (!existing && message.role !== "user") {
            setResult(null);
            return;
          }

          const timestamp = Number.isFinite(message.timestamp)
            ? message.timestamp
            : Date.now();
          const firstUserMessage =
            existing?.title && existing.title !== "New chat"
              ? existing.title
              : message.role === "user"
                ? message.content
                : existing?.title || "New chat";
          const index = Number.isInteger(existing?.messageCount)
            ? existing.messageCount
            : 0;
          const updatedChat = {
            ...existing,
            id: chatId,
            title: firstUserMessage,
            messageCount: index + 1,
            createdAt: Number.isFinite(existing?.createdAt)
              ? existing.createdAt
              : timestamp,
            updatedAt: timestamp,
          };
          try {
            messages.put({
              chatId: String(chatId),
              index,
              message: { ...message, timestamp },
            });
            writeChatRecord(chats, updatedChat);
            setResult({
              ...updatedChat,
              messages: [...(existing?.messages || []), { ...message, timestamp }],
            });
          } catch (error) {
            fail(error, "write conversation");
          }
        };
      }
    );
  });
}

function deleteChatHistory(chatId) {
  return queueChatHistoryWrite(async () => {
    const db = await openChatHistoryDb();
    await prepareChatHistory(db);
    return runChatHistoryTransaction(
      db,
      [CHAT_HISTORY_STORE, CHAT_MESSAGE_STORE],
      "readwrite",
      "delete chat",
      (transaction) => {
        transaction.objectStore(CHAT_HISTORY_STORE).delete(chatId);
        transaction.objectStore(CHAT_MESSAGE_STORE).delete(
          window.IDBKeyRange.bound(
            [String(chatId), 0],
            [String(chatId), Number.MAX_SAFE_INTEGER]
          )
        );
      }
    );
  });
}

async function readCoverDefaults() {
  const textDetails = readCoverTextDefaults();
  try {
    const db = await openCoverDefaultsDb();
    const { logo, legacy } = await new Promise((resolve, reject) => {
      let savedLogo = null;
      let legacyDetails = null;
      let transaction;
      try {
        transaction = db.transaction(COVER_DEFAULTS_STORE, "readonly");
        const store = transaction.objectStore(COVER_DEFAULTS_STORE);
        store.get(COVER_LOGO_KEY).onsuccess = (event) => {
          savedLogo = event.target.result || null;
        };
        store.get(LEGACY_COVER_DEFAULTS_KEY).onsuccess = (event) => {
          legacyDetails = event.target.result || null;
        };
      } catch (error) {
        db.close();
        reject(error);
        return;
      }

      transaction.oncomplete = () => {
        db.close();
        resolve({ logo: savedLogo, legacy: legacyDetails });
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error("Could not read saved details."));
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error || new Error("Could not read saved details."));
      };
    });

    const oldDetails =
      legacy && typeof legacy === "object" && !Array.isArray(legacy)
        ? legacy
        : {};
    const legacyTextDetails = Object.fromEntries(
      COVER_TEXT_FIELDS.map((field) => [
        field,
        typeof oldDetails[field] === "string" ? oldDetails[field] : "",
      ])
    );
    const logoDataUrl =
      logo instanceof Blob
        ? await blobToDataUrl(logo)
        : typeof oldDetails.logo_data_url === "string"
          ? oldDetails.logo_data_url
          : "";

    if (!textDetails && !legacy && !logo) {
      return { details: null, storageError: null };
    }
    return {
      details: {
        ...legacyTextDetails,
        ...textDetails,
        logo_data_url: logoDataUrl,
      },
      storageError: null,
    };
  } catch (storageError) {
    if (!textDetails) throw storageError;
    return {
      details: { ...textDetails, logo_data_url: "" },
      storageError,
    };
  }
}

async function writeCoverDefaults(details) {
  const textDetails = Object.fromEntries(
    COVER_TEXT_FIELDS.map((field) => [field, details[field]])
  );
  const logoBlob = details.logo_data_url
    ? dataUrlToBlob(details.logo_data_url)
    : null;

  window.localStorage.setItem(
    COVER_TEXT_STORAGE_KEY,
    JSON.stringify(textDetails)
  );

  try {
    await updateCoverDefaultsStore((store) => {
      if (logoBlob) {
        store.put(logoBlob, COVER_LOGO_KEY);
      } else {
        store.delete(COVER_LOGO_KEY);
      }
      store.delete(LEGACY_COVER_DEFAULTS_KEY);
    });
  } catch (error) {
    const storageError = new Error(
      `Text fields were saved, but logo storage failed: ${error.message}`,
      { cause: error }
    );
    storageError.name = error.name || "StorageError";
    throw storageError;
  }
}

async function deleteCoverDefaults() {
  const previousText = window.localStorage.getItem(COVER_TEXT_STORAGE_KEY);
  window.localStorage.removeItem(COVER_TEXT_STORAGE_KEY);

  try {
    await updateCoverDefaultsStore((store) => {
      store.delete(COVER_LOGO_KEY);
      store.delete(LEGACY_COVER_DEFAULTS_KEY);
    });
  } catch (error) {
    try {
      if (previousText !== null) {
        window.localStorage.setItem(COVER_TEXT_STORAGE_KEY, previousText);
      }
    } catch (restoreError) {
      throw new Error(
        `Could not reset browser storage (${error.message}) or restore text details (${restoreError.message}).`,
        { cause: restoreError }
      );
    }
    throw error;
  }
}

function coverStorageErrorMessage(action, error) {
  const name =
    error && typeof error === "object" && "name" in error
      ? error.name
      : "StorageError";
  const message =
    error instanceof Error ? error.message : String(error || "Unknown error.");
  const guidance =
    name === "QuotaExceededError"
      ? "Free browser storage space and try again."
      : name === "SecurityError"
        ? "Allow this site to use browser storage and try again."
        : "Check that browser storage is enabled for this site and try again.";
  return `Could not ${action} details (${name}): ${message}. ${guidance}`;
}

function DocumentSelector({
  id,
  selectedSource,
  sources,
  sourcesLoading,
  uploading,
  onSourceChange,
  onFilesSelected,
}) {
  const inputRef = useRef(null);

  function handleFileSelection(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    onFilesSelected(files);
  }

  return (
    <div className="document-select-field">
      <label htmlFor={`${id}-source`}>Lecture document</label>
      <div className="document-select-row">
        <select
          id={`${id}-source`}
          value={selectedSource}
          onChange={(event) => onSourceChange(event.target.value)}
          disabled={sourcesLoading || sources.length === 0}
        >
          <option value="all">All available lecture documents</option>
          {sources.map((source) => (
            <option key={source} value={source}>{source}</option>
          ))}
        </select>
        <input
          ref={inputRef}
          className="file-input"
          type="file"
          accept=".pdf,application/pdf"
          multiple
          onChange={handleFileSelection}
          aria-label="Select PDF files to upload"
        />
        <button
          type="button"
          className="document-attach-button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          Attach PDF
        </button>
      </div>
    </div>
  );
}

function ExamDocumentSelector({
  sources,
  sourcesLoading,
  uploading,
  allDocuments,
  selectedSources,
  onAllDocumentsChange,
  onSelectedSourcesChange,
  onFilesSelected,
  title = "Study documents",
  allowTopicOnly = false,
  maxSelectedSources,
}) {
  const inputRef = useRef(null);

  function handleFileSelection(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    onFilesSelected(files);
  }

  function toggleSource(source) {
    onSelectedSourcesChange((previous) =>
      previous.includes(source)
        ? previous.filter((item) => item !== source)
        : [...previous, source]
    );
  }

  return (
    <fieldset className="exam-documents">
      <legend>{title}</legend>
      <div className="exam-document-toolbar">
        <label className="exam-document-choice">
          <input
            type="checkbox"
            checked={allDocuments}
            onChange={(event) => onAllDocumentsChange(event.target.checked)}
            disabled={
              sourcesLoading ||
              sources.length === 0 ||
              (maxSelectedSources && sources.length > maxSelectedSources)
            }
          />
          <span>
            {maxSelectedSources
              ? `Use all indexed PDFs (up to ${maxSelectedSources})`
              : "Use all indexed PDFs"}
          </span>
        </label>
        <input
          ref={inputRef}
          className="file-input"
          type="file"
          accept=".pdf,application/pdf"
          multiple
          onChange={handleFileSelection}
          aria-label={`Attach multiple ${title.toLowerCase()} PDFs`}
        />
        <button
          type="button"
          className="document-attach-button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Indexing PDFs..." : "Attach PDFs"}
        </button>
      </div>
      {sourcesLoading ? (
        <p className="exam-documents-hint" role="status">
          Loading indexed lecture PDFs...
        </p>
      ) : sources.length === 0 ? (
        <p className="exam-documents-hint">
          No indexed PDFs yet. Attach one or more text-based PDFs to get started.
        </p>
      ) : (
        <div className="exam-document-list">
          {sources.map((source) => (
            <label key={source} className="exam-document-choice">
              <input
                type="checkbox"
                checked={allDocuments || selectedSources.includes(source)}
                disabled={
                  allDocuments ||
                  (maxSelectedSources &&
                    selectedSources.length >= maxSelectedSources &&
                    !selectedSources.includes(source))
                }
                onChange={() => toggleSource(source)}
              />
              <span>{source}</span>
            </label>
          ))}
        </div>
      )}
      {!allDocuments && selectedSources.length === 0 && sources.length > 0 && (
        <p className="exam-documents-hint">
          {allowTopicOnly
            ? "Select PDFs, or leave none selected to search indexed lecture material for your topic."
            : "Select one or more PDFs, or choose all indexed PDFs."}
        </p>
      )}
      {maxSelectedSources && sources.length > maxSelectedSources && (
        <p className="exam-documents-hint">
          Select up to {maxSelectedSources} PDFs for one research request.
        </p>
      )}
    </fieldset>
  );
}

function getDefaultExamDate() {
  const examDate = new Date();
  examDate.setDate(examDate.getDate() + 14);
  return [
    examDate.getFullYear(),
    String(examDate.getMonth() + 1).padStart(2, "0"),
    String(examDate.getDate()).padStart(2, "0"),
  ].join("-");
}

function getEarliestExamDate() {
  const examDate = new Date();
  examDate.setDate(examDate.getDate() + 1);
  return [
    examDate.getFullYear(),
    String(examDate.getMonth() + 1).padStart(2, "0"),
    String(examDate.getDate()).padStart(2, "0"),
  ].join("-");
}

function App() {
  const [messages, setMessages] = useState([]);
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [chatHistoryError, setChatHistoryError] = useState("");
  const [chatHistoryLoaded, setChatHistoryLoaded] = useState(false);
  const [deletingChatId, setDeletingChatId] = useState(null);
  const [renamingChatId, setRenamingChatId] = useState(null);
  const [exportingBrowserHistory, setExportingBrowserHistory] = useState(false);
  const [chatHistoryStatus, setChatHistoryStatus] = useState("");
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState(() => {
    try {
      const cached = JSON.parse(
        localStorage.getItem(SUGGESTIONS_STORAGE_KEY) || "[]"
      );
      return Array.isArray(cached) ? cached : [];
    } catch {
      return [];
    }
  });
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [suggestionsMessage, setSuggestionsMessage] = useState("");
  const [uploads, setUploads] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [examOpen, setExamOpen] = useState(false);
  const [presentationOpen, setPresentationOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [notesSources, setNotesSources] = useState([]);
  const [notesSourcesLoading, setNotesSourcesLoading] = useState(false);
  const [notesSelectedSource, setNotesSelectedSource] = useState("all");
  const [notesType, setNotesType] = useState("short");
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState("");
  const [notesStatus, setNotesStatus] = useState("");
  const [notesContent, setNotesContent] = useState("");
  const [notesEditing, setNotesEditing] = useState(false);
  const [notesTitle, setNotesTitle] = useState("");
  const [notesUsedSources, setNotesUsedSources] = useState([]);
  const [notesPdfExporting, setNotesPdfExporting] = useState(false);
  const [quizSources, setQuizSources] = useState([]);
  const [quizSourcesLoading, setQuizSourcesLoading] = useState(false);
  const [quizSelectedSource, setQuizSelectedSource] = useState("all");
  const [quizQuestionCount, setQuizQuestionCount] = useState("5");
  const [quizDifficulty, setQuizDifficulty] = useState("Medium");
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState("");
  const [quizStatus, setQuizStatus] = useState("");
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [quizSourcesUsed, setQuizSourcesUsed] = useState([]);
  const [quizUsedDifficulty, setQuizUsedDifficulty] = useState("");
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [examSources, setExamSources] = useState([]);
  const [examSourcesLoading, setExamSourcesLoading] = useState(false);
  const [examSelectedSources, setExamSelectedSources] = useState([]);
  const [examAllDocuments, setExamAllDocuments] = useState(true);
  const [examSubject, setExamSubject] = useState("");
  const [examDate, setExamDate] = useState(getDefaultExamDate);
  const [examStudyHours, setExamStudyHours] = useState("2");
  const [examPlanLoading, setExamPlanLoading] = useState(false);
  const [examPlanError, setExamPlanError] = useState("");
  const [examPlanStatus, setExamPlanStatus] = useState("");
  const [examPlan, setExamPlan] = useState(null);
  const [examCompletedTopics, setExamCompletedTopics] = useState([]);
  const [examPracticeCount, setExamPracticeCount] = useState("9");
  const [examDifficulty, setExamDifficulty] = useState("Medium");
  const [examPracticeLoading, setExamPracticeLoading] = useState(false);
  const [examPracticeError, setExamPracticeError] = useState("");
  const [examPracticeStatus, setExamPracticeStatus] = useState("");
  const [examQuestions, setExamQuestions] = useState([]);
  const [examAnswers, setExamAnswers] = useState({});
  const [examSelfRatings, setExamSelfRatings] = useState({});
  const [examPracticeSubmitted, setExamPracticeSubmitted] = useState(false);
  const [examPracticeDifficulty, setExamPracticeDifficulty] = useState("");
  const [examPracticeFocus, setExamPracticeFocus] = useState([]);
  const [presentationSources, setPresentationSources] = useState([]);
  const [presentationSourcesLoading, setPresentationSourcesLoading] = useState(false);
  const [presentationSelectedSources, setPresentationSelectedSources] = useState([]);
  const [presentationAllDocuments, setPresentationAllDocuments] = useState(false);
  const [presentationTopic, setPresentationTopic] = useState("");
  const [presentationSlideCount, setPresentationSlideCount] = useState("8");
  const [presentationLanguage, setPresentationLanguage] = useState("English");
  const [presentationStyle, setPresentationStyle] = useState("Academic");
  const [presentationLoading, setPresentationLoading] = useState(false);
  const [presentationExporting, setPresentationExporting] = useState(false);
  const [presentationError, setPresentationError] = useState("");
  const [presentationStatus, setPresentationStatus] = useState("");
  const [presentationResult, setPresentationResult] = useState(null);
  const [presentationPreviewIndex, setPresentationPreviewIndex] = useState(0);
  const [researchSources, setResearchSources] = useState([]);
  const [researchSourcesLoading, setResearchSourcesLoading] = useState(false);
  const [researchSelectedSources, setResearchSelectedSources] = useState([]);
  const [researchAllDocuments, setResearchAllDocuments] = useState(true);
  const [researchTopic, setResearchTopic] = useState("");
  const [researchCitationStyle, setResearchCitationStyle] = useState("APA");
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchExporting, setResearchExporting] = useState(false);
  const [researchError, setResearchError] = useState("");
  const [researchStatus, setResearchStatus] = useState("");
  const [researchTitle, setResearchTitle] = useState("");
  const [researchContent, setResearchContent] = useState("");
  const [researchEditing, setResearchEditing] = useState(true);
  const [researchUsedSources, setResearchUsedSources] = useState([]);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [assignmentDraft, setAssignmentDraft] = useState("");
  const [assignmentSources, setAssignmentSources] = useState([]);
  const [copyMessage, setCopyMessage] = useState("");
  const [pdfExporting, setPdfExporting] = useState(false);
  const [coverError, setCoverError] = useState("");
  const [coverStatus, setCoverStatus] = useState("");
  const [coverSaving, setCoverSaving] = useState(false);
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
  const activeChatIdRef = useRef(null);

  const refreshSuggestions = useCallback(async () => {
    try {
      const response = await fetch(SUGGESTIONS_URL);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "The server could not load study suggestions."
        );
      }

      const nextSuggestions = Array.isArray(data.suggestions)
        ? data.suggestions.filter(
            (item) =>
              item &&
              typeof item.title === "string" &&
              typeof item.question === "string"
          )
        : [];
      if (nextSuggestions.length !== 4) {
        throw new Error("The server did not return four study suggestions.");
      }

      setSuggestions(nextSuggestions);
      setSuggestionsMessage("");
      try {
        localStorage.setItem(
          SUGGESTIONS_STORAGE_KEY,
          JSON.stringify(nextSuggestions)
        );
      } catch (storageError) {
        console.error("[UniAssist] Study suggestions could not be cached", {
          error: storageError,
        });
      }
      if (data.fallback) {
        setSuggestionsMessage(
          "Showing questions derived from your indexed PDFs."
        );
      }
    } catch (suggestionError) {
      console.error("[UniAssist] Study suggestions could not be refreshed", {
        error: suggestionError,
      });
      setSuggestionsMessage(
        "Suggestions could not be refreshed. Showing the most recently saved suggestions, if available."
      );
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timerId = window.setTimeout(refreshSuggestions, 0);
    return () => window.clearTimeout(timerId);
  }, [refreshSuggestions]);

  useEffect(() => {
    let active = true;
    listConversations()
      .then(async (savedChats) => {
        if (!active) return;
        setChats(savedChats);
        if (savedChats.length > 0) {
          const firstChat = await getConversation(savedChats[0].id);
          if (!active) return;
          activeChatIdRef.current = savedChats[0].id;
          setActiveChatId(savedChats[0].id);
          setMessages(firstChat.messages);
        }
      })
      .catch((historyError) => {
        if (active) {
          setChatHistoryError(`Chat history could not be loaded: ${historyError.message}`);
        }
      })
      .finally(() => {
        if (active) setChatHistoryLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    readCoverDefaults()
      .then(({ details, storageError }) => {
        if (active && details) {
          setCover((previous) => ({
            ...previous,
            ...details,
            subject_name: previous.subject_name,
          }));
        }
        if (active && storageError) {
          setCoverError(
            coverStorageErrorMessage("load logo", storageError)
          );
        }
      })
      .catch((storageError) => {
        if (active) {
          setCoverError(
            coverStorageErrorMessage("load saved", storageError)
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function sendMessage(text = question) {
    const cleanQuestion = text.trim();

    if (!cleanQuestion || loading) return;

    const chatId = activeChatIdRef.current || createChatId();
    const userMessage = { role: "user", content: cleanQuestion };
    activeChatIdRef.current = chatId;
    setActiveChatId(chatId);
    setMessages((previous) => [...previous, userMessage]);
    setQuestion("");
    setError("");
    setChatHistoryError("");
    setLoading(true);
    const userMessageSaved = saveConversationMessage(chatId, userMessage)
      .then((savedChat) => {
        setChats((previous) => [
          savedChat,
          ...previous.filter((chat) => chat.id !== savedChat.id),
        ]);
        return true;
      })
      .catch((historyError) => {
        setChatHistoryError(
          `Chat history could not be saved: ${historyError.message}`
        );
        return false;
      });

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

      const assistantMessage = {
        role: "assistant",
        content: data.answer || "No answer was returned.",
        sources: (data.sources || []).map((source) => ({
          filename: source.filename || source.source || "Unknown PDF",
          page: source.page ?? "Unknown",
        })),
      };
      if (activeChatIdRef.current === chatId) {
        setMessages((previous) => [...previous, assistantMessage]);
      }

      if (await userMessageSaved) {
        try {
          const savedChat = await saveConversationMessage(chatId, assistantMessage);
          setChats((previous) => [
            savedChat,
            ...previous.filter((chat) => chat.id !== savedChat.id),
          ]);
        } catch (historyError) {
          setChatHistoryError(
            `Chat history could not be saved: ${historyError.message}`
          );
        }
      }
    } catch (err) {
      if (activeChatIdRef.current === chatId) {
        setError(
          err.message === "Failed to fetch"
            ? "Cannot connect to the backend. Make sure FastAPI is running at http://127.0.0.1:8000."
            : err.message || "Something went wrong. Please try again."
        );
      }
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
    setCoverStatus("");
    setCoverError("");
  }

  async function saveCoverDefaults() {
    setCoverSaving(true);
    setCoverError("");
    setCoverStatus("");
    const { university_name, student_name, teacher_name, registration_number, logo_data_url } = cover;

    try {
      await writeCoverDefaults({
        university_name,
        student_name,
        teacher_name,
        registration_number,
        logo_data_url,
      });
      setCoverStatus("Default cover details saved in this browser.");
    } catch (storageError) {
      setCoverError(coverStorageErrorMessage("save", storageError));
    } finally {
      setCoverSaving(false);
    }
  }

  async function resetCoverDefaults() {
    setCoverSaving(true);
    setCoverError("");
    setCoverStatus("");

    try {
      await deleteCoverDefaults();
      setCover((previous) => ({
        ...previous,
        university_name: "",
        student_name: "",
        teacher_name: "",
        registration_number: "",
        logo_data_url: "",
      }));
      if (logoInputRef.current) {
        logoInputRef.current.value = "";
      }
      setCoverStatus("Saved cover details have been reset.");
    } catch (storageError) {
      setCoverError(coverStorageErrorMessage("reset", storageError));
    } finally {
      setCoverSaving(false);
    }
  }

  function toggleAssignment() {
    setAssignmentOpen((opening) => !opening);
    setNotesOpen(false);
    setQuizOpen(false);
    setExamOpen(false);
    setPresentationOpen(false);
    setResearchOpen(false);
    setCoverStatus("");
  }

  async function openNotesGenerator() {
    setAssignmentOpen(true);
    setNotesOpen(true);
    setQuizOpen(false);
    setExamOpen(false);
    setPresentationOpen(false);
    setResearchOpen(false);
    setNotesError("");
    setNotesStatus("");
    setNotesSourcesLoading(true);
    try {
      const sources = await listNotesSources();
      setNotesSources(sources);
      if (sources.length === 0) {
        setNotesError(
          "No lecture PDFs are available yet. Upload and index a PDF first."
        );
      }
    } catch (sourceError) {
      setNotesError(sourceError.message);
    } finally {
      setNotesSourcesLoading(false);
    }
  }

  async function openQuizGenerator() {
    setAssignmentOpen(true);
    setNotesOpen(false);
    setQuizOpen(true);
    setExamOpen(false);
    setPresentationOpen(false);
    setResearchOpen(false);
    setQuizError("");
    setQuizStatus("");
    setQuizSourcesLoading(true);
    try {
      const sources = await listQuizSources();
      setQuizSources(sources);
      if (sources.length === 0) {
        setQuizError(
          "No lecture PDFs are available yet. Upload and index a PDF first."
        );
      }
    } catch (sourceError) {
      setQuizError(sourceError.message);
    } finally {
      setQuizSourcesLoading(false);
    }
  }

  async function openExamPreparation() {
    setAssignmentOpen(true);
    setNotesOpen(false);
    setQuizOpen(false);
    setExamOpen(true);
    setPresentationOpen(false);
    setResearchOpen(false);
    setExamPlanError("");
    setExamPlanStatus("");
    setExamSourcesLoading(true);
    try {
      const sources = await listExamSources();
      setExamSources(sources);
      setExamSelectedSources((previous) =>
        previous.filter((source) => sources.includes(source))
      );
      if (sources.length === 0) {
        setExamPlanError(
          "No lecture PDFs are indexed yet. Attach and index PDFs to create an exam plan."
        );
      }
    } catch (sourceError) {
      setExamPlanError(sourceError.message);
    } finally {
      setExamSourcesLoading(false);
    }
  }

  async function openPresentationBuilder() {
    setAssignmentOpen(true);
    setNotesOpen(false);
    setQuizOpen(false);
    setExamOpen(false);
    setPresentationOpen(true);
    setResearchOpen(false);
    setPresentationError("");
    setPresentationStatus("");
    setPresentationSourcesLoading(true);
    try {
      const sources = await listPresentationSources();
      setPresentationSources(sources);
      setPresentationSelectedSources((previous) =>
        previous.filter((source) => sources.includes(source))
      );
    } catch (sourceError) {
      setPresentationError(sourceError.message);
    } finally {
      setPresentationSourcesLoading(false);
    }
  }

  async function openResearchAssistant() {
    setAssignmentOpen(true);
    setNotesOpen(false);
    setQuizOpen(false);
    setExamOpen(false);
    setPresentationOpen(false);
    setResearchOpen(true);
    setResearchError("");
    setResearchStatus("");
    setResearchSourcesLoading(true);
    try {
      const sources = await listResearchSources();
      setResearchSources(sources);
      setResearchSelectedSources((previous) =>
        previous.filter((source) => sources.includes(source)).slice(0, 12)
      );
      setResearchAllDocuments(sources.length > 0 && sources.length <= 12);
    } catch (sourceError) {
      setResearchError(sourceError.message);
    } finally {
      setResearchSourcesLoading(false);
    }
  }

  async function handleGenerateNotes(event) {
    event.preventDefault();
    setNotesLoading(true);
    setNotesError("");
    setNotesStatus("");
    try {
      const data = await generateNotes({
        note_type: notesType,
        all_documents: notesSelectedSource === "all",
        selected_sources:
          notesSelectedSource === "all" ? [] : [notesSelectedSource],
      });
      setNotesContent(data.notes);
      setNotesEditing(false);
      setNotesTitle(data.title);
      setNotesUsedSources(data.sources);
      setNotesStatus("Notes generated from the selected lecture material.");
    } catch (generationError) {
      setNotesError(generationError.message);
    } finally {
      setNotesLoading(false);
    }
  }

  async function requestQuiz() {
    setQuizLoading(true);
    setQuizError("");
    setQuizStatus("");
    setQuizQuestions([]);
    setQuizAnswers({});
    setQuizSubmitted(false);
    try {
      const data = await generateQuiz({
        question_count: Number(quizQuestionCount),
        difficulty: quizDifficulty,
        all_documents: quizSelectedSource === "all",
        selected_sources:
          quizSelectedSource === "all" ? [] : [quizSelectedSource],
      });
      setQuizQuestions(data.questions);
      setQuizSourcesUsed(data.sources);
      setQuizUsedDifficulty(data.difficulty);
      setQuizStatus("Quiz ready. Answer every question, then submit to see your results.");
    } catch (generationError) {
      setQuizError(generationError.message);
    } finally {
      setQuizLoading(false);
    }
  }

  async function handleGenerateQuiz(event) {
    event.preventDefault();
    await requestQuiz();
  }

  function submitQuiz(event) {
    event.preventDefault();
    setQuizSubmitted(true);
    setQuizStatus("Quiz submitted. Review the correct answers and explanations below.");
  }

  function restartQuiz() {
    setQuizAnswers({});
    setQuizSubmitted(false);
    setQuizStatus("Your answers have been cleared. Try the same quiz again.");
  }

  async function generateAnotherQuiz() {
    setQuizQuestions([]);
    setQuizAnswers({});
    setQuizSubmitted(false);
    await requestQuiz();
  }

  async function handleGenerateExamPlan(event) {
    event.preventDefault();
    setExamPlanLoading(true);
    setExamPlanError("");
    setExamPlanStatus("");
    setExamPlan(null);
    setExamCompletedTopics([]);
    setExamQuestions([]);
    setExamAnswers({});
    setExamSelfRatings({});
    setExamPracticeSubmitted(false);

    try {
      const plan = await generateExamPlan({
        subject: examSubject.trim(),
        exam_date: examDate,
        study_hours_per_day: Number(examStudyHours),
        all_documents: examAllDocuments,
        selected_sources: examAllDocuments ? [] : examSelectedSources,
      });
      setExamPlan(plan);
      setExamPlanStatus("Your topic-wise exam preparation plan is ready.");
    } catch (planError) {
      setExamPlanError(planError.message);
    } finally {
      setExamPlanLoading(false);
    }
  }

  async function generateExamPractice(focusTopics = []) {
    if (!examPlan) return;
    setExamPracticeLoading(true);
    setExamPracticeError("");
    setExamPracticeStatus("");
    setExamQuestions([]);
    setExamAnswers({});
    setExamSelfRatings({});
    setExamPracticeSubmitted(false);
    setExamPracticeFocus(focusTopics);

    try {
      const result = await createExamPractice({
        subject: examPlan.subject,
        question_count: Number(examPracticeCount),
        difficulty: examDifficulty,
        focus_topics: focusTopics,
        all_documents: false,
        selected_sources: examPlan.sources,
      });
      setExamQuestions(result.questions);
      setExamPracticeDifficulty(result.difficulty);
      setExamPracticeStatus(
        focusTopics.length
          ? `Practice questions generated for: ${focusTopics.join(", ")}.`
          : "Mock exam generated. Submit your answers to review model answers and explanations."
      );
    } catch (practiceError) {
      setExamPracticeError(practiceError.message);
    } finally {
      setExamPracticeLoading(false);
    }
  }

  async function handleGenerateExamPractice(event) {
    event.preventDefault();
    await generateExamPractice();
  }

  function submitExamPractice(event) {
    event.preventDefault();
    setExamPracticeSubmitted(true);
    setExamPracticeStatus(
      "Answers submitted. Review the model answers and self-rate your written responses."
    );
  }

  async function handleGeneratePresentation(event) {
    event.preventDefault();
    setPresentationLoading(true);
    setPresentationError("");
    setPresentationStatus(
      "Retrieving the selected lecture material and drafting your slides..."
    );
    setPresentationResult(null);

    try {
      const result = await generatePresentation({
        topic: presentationTopic.trim(),
        slide_count: Number(presentationSlideCount),
        language: presentationLanguage,
        style: presentationStyle,
        all_documents: presentationAllDocuments,
        selected_sources: presentationAllDocuments
          ? []
          : presentationSelectedSources,
      });
      setPresentationResult(result);
      setPresentationPreviewIndex(0);
      setPresentationStatus(
        `Created ${result.slides.length} source-grounded slides. Review or edit them before exporting.`
      );
    } catch (generationError) {
      setPresentationError(generationError.message);
      setPresentationStatus("");
    } finally {
      setPresentationLoading(false);
    }
  }

  function updatePresentationSlide(index, field, value) {
    setPresentationResult((previous) => ({
      ...previous,
      slides: previous.slides.map((slide, slideIndex) =>
        slideIndex === index ? { ...slide, [field]: value } : slide
      ),
    }));
  }

  function updatePresentationKeyPoints(index, value) {
    updatePresentationSlide(
      index,
      "key_points",
      value.split("\n").map((point) => point.trim()).filter(Boolean)
    );
  }

  async function handleDownloadPresentation() {
    if (!presentationResult) return;
    setPresentationExporting(true);
    setPresentationError("");
    setPresentationStatus("Building your editable PowerPoint file...");

    try {
      const file = await downloadPresentationPptx({
        title: presentationResult.title,
        language: presentationResult.language,
        style: presentationResult.style,
        slides: presentationResult.slides,
      });
      const downloadUrl = URL.createObjectURL(file);
      const link = document.createElement("a");
      const safeTitle = presentationResult.title
        .replace(/[<>:"/\\|?*]+/g, "-")
        .trim();
      link.href = downloadUrl;
      link.download = `${safeTitle || "uniassist-presentation"}.pptx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setPresentationStatus("Your editable PowerPoint presentation was downloaded.");
    } catch (exportError) {
      setPresentationError(exportError.message);
      setPresentationStatus("");
    } finally {
      setPresentationExporting(false);
    }
  }

  async function handleGenerateResearch(event) {
    event.preventDefault();
    setResearchLoading(true);
    setResearchError("");
    setResearchStatus(
      "Reviewing the selected papers and drafting source-cited research content..."
    );
    setResearchTitle("");
    setResearchContent("");
    setResearchUsedSources([]);

    try {
      const result = await generateResearch({
        topic: researchTopic.trim(),
        citation_style: researchCitationStyle,
        all_documents: researchAllDocuments,
        selected_sources: researchAllDocuments ? [] : researchSelectedSources,
      });
      setResearchTitle(result.title);
      setResearchContent(result.content);
      setResearchEditing(true);
      setResearchUsedSources(result.sources);
      setResearchStatus(
        "Research draft ready. Suggestions and source-supported summaries are labeled for verification."
      );
    } catch (generationError) {
      setResearchError(generationError.message);
      setResearchStatus("");
    } finally {
      setResearchLoading(false);
    }
  }

  async function handleCopyResearch() {
    try {
      await navigator.clipboard.writeText(researchContent);
      setResearchStatus("Research content copied to the clipboard.");
      setResearchError("");
    } catch {
      setResearchError(
        "Could not copy the research content. Select the text and copy it manually."
      );
    }
  }

  async function handleDownloadResearch(format) {
    if (!researchContent.trim()) return;
    setResearchExporting(true);
    setResearchError("");
    setResearchStatus(`Preparing your ${format.toUpperCase()} export...`);
    try {
      const exportRequest = {
        title: researchTitle || "Research draft",
        content: researchContent,
        sources: researchUsedSources,
      };
      const file = format === "pdf"
        ? await downloadResearchPdf(exportRequest)
        : await downloadResearchDocx(exportRequest);
      const downloadUrl = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `uniassist-research.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setResearchStatus(`Research ${format.toUpperCase()} downloaded.`);
    } catch (exportError) {
      setResearchError(exportError.message);
      setResearchStatus("");
    } finally {
      setResearchExporting(false);
    }
  }

  function restartExamPractice() {
    setExamAnswers({});
    setExamSelfRatings({});
    setExamPracticeSubmitted(false);
    setExamPracticeStatus("Your practice answers were cleared. Start again when ready.");
  }

  function toggleExamTopic(topic) {
    setExamCompletedTopics((previous) =>
      previous.includes(topic)
        ? previous.filter((item) => item !== topic)
        : [...previous, topic]
    );
  }

  const examWeakTopics = getWeakExamTopics(
    examQuestions,
    examAnswers,
    examSelfRatings
  );

  function renderExamPanel() {
    const examScore = scoreExamPractice(
      examQuestions,
      examAnswers,
      examSelfRatings
    );
    const completedTopicCount = examPlan
      ? examCompletedTopics.filter((topic) =>
          examPlan.topics.some((item) => item.topic === topic)
        ).length
      : 0;
    const progressPercent = examPlan
      ? Math.round((completedTopicCount / examPlan.topics.length) * 100)
      : 0;

    return (
      <div className="exam-panel">
        <div className="notes-heading">
          <p className="eyebrow">PREPARE WITH YOUR COURSE MATERIAL</p>
          <h1>Exam Preparation Mode</h1>
          <p>
            Build a topic-wise study plan, track your progress, and practice
            with source-grounded mock exams.
          </p>
        </div>

        <form className="notes-form exam-plan-form" onSubmit={handleGenerateExamPlan}>
          <ExamDocumentSelector
            sources={examSources}
            sourcesLoading={examSourcesLoading}
            uploading={uploading}
            allDocuments={examAllDocuments}
            selectedSources={examSelectedSources}
            onAllDocumentsChange={setExamAllDocuments}
            onSelectedSourcesChange={setExamSelectedSources}
            onFilesSelected={handleFileSelection}
          />
          <label>
            Subject
            <input
              type="text"
              value={examSubject}
              onChange={(event) => setExamSubject(event.target.value)}
              placeholder="e.g. Database Systems"
              maxLength={200}
              required
            />
          </label>
          <label>
            Exam date
            <input
              type="date"
              value={examDate}
              min={getEarliestExamDate()}
              onChange={(event) => setExamDate(event.target.value)}
              required
            />
          </label>
          <label>
            Study hours per day
            <input
              type="number"
              min="0.5"
              max="16"
              step="0.5"
              value={examStudyHours}
              onChange={(event) => setExamStudyHours(event.target.value)}
              required
            />
          </label>
          <div className="notes-form-actions">
            <button
              type="submit"
              className="assignment-generate"
              disabled={
                examPlanLoading ||
                examSourcesLoading ||
                uploading ||
                examSources.length === 0 ||
                (!examAllDocuments && examSelectedSources.length === 0)
              }
            >
              {examPlanLoading ? "Building your plan..." : "Generate study plan"}
            </button>
            <button
              type="button"
              className="notes-back-button"
              onClick={() => {
                setExamOpen(false);
                setAssignmentOpen(false);
              }}
            >
              Back to chat
            </button>
          </div>
        </form>

        {renderUploadList()}
        {examSourcesLoading && (
          <p className="notes-status" role="status">
            Loading your indexed lecture PDFs...
          </p>
        )}
        {examPlanLoading && (
          <p className="notes-status" role="status">
            Reviewing selected documents and organizing your study topics...
          </p>
        )}
        {examPlanError && (
          <div className="error-message" role="alert">
            <span>⚠</span> {examPlanError}
          </div>
        )}
        {examPlanStatus && !examPlanLoading && (
          <p className="notes-status" role="status">{examPlanStatus}</p>
        )}

        {examPlan && (
          <section className="exam-plan-result">
            <div className="exam-progress-card">
              <div>
                <p className="eyebrow">YOUR PREPARATION PROGRESS</p>
                <h2>
                  {examPlan.subject} · {examPlan.days_until_exam} days remaining
                </h2>
                <p>
                  Exam date: {examPlan.exam_date} · {completedTopicCount} of{" "}
                  {examPlan.topics.length} topics completed
                  · {examPlan.study_hours_per_day} study hours per day
                </p>
              </div>
              <strong>{progressPercent}%</strong>
              <progress
                value={completedTopicCount}
                max={examPlan.topics.length}
                aria-label="Exam preparation topic progress"
              />
            </div>

            <div className="exam-plan-section">
              <h2>Important topics and key concepts</h2>
              <div className="exam-topic-list">
                {examPlan.topics.map((topic) => {
                  const completed = examCompletedTopics.includes(topic.topic);
                  return (
                    <article
                      className={`exam-topic-card${completed ? " completed" : ""}`}
                      key={topic.topic}
                    >
                      <div className="exam-topic-heading">
                        <label>
                          <input
                            type="checkbox"
                            checked={completed}
                            onChange={() => toggleExamTopic(topic.topic)}
                          />
                          <span>{topic.topic}</span>
                        </label>
                        <span className={`exam-importance ${topic.importance.toLowerCase()}`}>
                          {topic.importance} priority
                        </span>
                      </div>
                      <p className="exam-topic-hours">
                        Suggested study time: {topic.recommended_hours} hours
                      </p>
                      <ul>
                        {topic.key_concepts.map((concept) => (
                          <li key={concept}>{concept}</li>
                        ))}
                      </ul>
                      <p className="quiz-citation">
                        Source: {topic.source} · Page {topic.page}
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="exam-plan-section">
              <h2>Daily study schedule</h2>
              <div className="exam-schedule">
                {examPlan.schedule.map((day) => (
                  <article className="exam-schedule-day" key={day.date}>
                    <strong>{day.date}</strong>
                    <span>{day.hours} hours</span>
                    <p>{day.topics.join(" · ")}</p>
                    <small>{day.task}</small>
                  </article>
                ))}
              </div>
            </div>

            <div className="exam-plan-section">
              <div className="exam-practice-heading">
                <div>
                  <h2>Practice test and mock exam</h2>
                  <p>
                    Questions include MCQs, short questions, and long questions.
                    Written answers are self-reviewed after submission.
                  </p>
                </div>
                {examWeakTopics.length > 0 && (
                  <button
                    type="button"
                    className="notes-back-button"
                    disabled={examPracticeLoading}
                    onClick={() => generateExamPractice(examWeakTopics)}
                  >
                    {examPracticeLoading ? "Generating..." : "Revise weak topics"}
                  </button>
                )}
              </div>
              <form className="notes-form exam-practice-form" onSubmit={handleGenerateExamPractice}>
                <label>
                  Number of questions
                  <input
                    type="number"
                    min="3"
                    max="20"
                    step="1"
                    value={examPracticeCount}
                    onChange={(event) => setExamPracticeCount(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Difficulty
                  <select
                    value={examDifficulty}
                    onChange={(event) => setExamDifficulty(event.target.value)}
                  >
                    <option>Easy</option>
                    <option>Medium</option>
                    <option>Hard</option>
                  </select>
                </label>
                <div className="notes-form-actions">
                  <button
                    type="submit"
                    className="assignment-generate"
                    disabled={examPracticeLoading || examPlanLoading}
                  >
                    {examPracticeLoading ? "Generating mock exam..." : "Generate practice test"}
                  </button>
                  {examQuestions.length > 0 && examPracticeSubmitted && (
                    <button
                      type="button"
                      className="notes-back-button"
                      onClick={() => generateExamPractice(examPracticeFocus)}
                      disabled={examPracticeLoading}
                    >
                      Generate another test
                    </button>
                  )}
                </div>
              </form>

              {examPracticeLoading && (
                <p className="notes-status" role="status">
                  Creating questions from the selected course material...
                </p>
              )}
              {examPracticeError && (
                <div className="error-message" role="alert">
                  <span>⚠</span> {examPracticeError}
                </div>
              )}
              {examPracticeStatus && !examPracticeLoading && (
                <p className="notes-status" role="status">{examPracticeStatus}</p>
              )}

              {examQuestions.length > 0 && (
                <>
                  {examPracticeSubmitted && (
                    <div className="quiz-score" aria-live="polite">
                      <h2>
                        {examScore.correct} correct of {examScore.graded} reviewed
                        {examScore.pending > 0 &&
                          ` · ${examScore.pending} written ${examScore.pending === 1 ? "answer" : "answers"} to self-review`}
                      </h2>
                      <p>
                        {examPracticeDifficulty} practice · {examQuestions.length} questions
                        {examPracticeFocus.length > 0 &&
                          ` · Focus: ${examPracticeFocus.join(", ")}`}
                      </p>
                    </div>
                  )}
                  <form className="quiz-questions" onSubmit={submitExamPractice}>
                    {examQuestions.map((question, index) => {
                      const correct = question.question_type === "mcq" &&
                        isQuizAnswerCorrect(question, examAnswers[index]);
                      const choices = question.options;
                      return (
                        <fieldset
                          className="quiz-question exam-practice-question"
                          key={`${index}-${question.question}`}
                        >
                          <legend>
                            Question {index + 1} · {question.topic} · {
                              question.question_type === "mcq"
                                ? "Multiple choice"
                                : question.question_type === "short"
                                  ? "Short question"
                                  : "Long question"
                            }
                          </legend>
                          <p>{question.question}</p>
                          {question.question_type === "mcq" ? (
                            <div className="quiz-options">
                              {choices.map((choice) => (
                                <label key={choice}>
                                  <input
                                    type="radio"
                                    name={`exam-question-${index}`}
                                    value={choice}
                                    checked={examAnswers[index] === choice}
                                    onChange={() =>
                                      setExamAnswers((answers) => ({
                                        ...answers,
                                        [index]: choice,
                                      }))
                                    }
                                    disabled={examPracticeSubmitted}
                                    required={!examPracticeSubmitted}
                                  />
                                  <span>{choice}</span>
                                </label>
                              ))}
                            </div>
                          ) : (
                            <textarea
                              className="exam-written-answer"
                              aria-label={`Your answer to question ${index + 1}`}
                              value={examAnswers[index] || ""}
                              onChange={(event) =>
                                setExamAnswers((answers) => ({
                                  ...answers,
                                  [index]: event.target.value,
                                }))
                              }
                              disabled={examPracticeSubmitted}
                              required={!examPracticeSubmitted}
                              maxLength={5000}
                              rows={question.question_type === "long" ? 6 : 3}
                            />
                          )}
                          <p className="quiz-citation">
                            Source: {question.source} · Page {question.page}
                          </p>
                          {examPracticeSubmitted && (
                            <div className={`quiz-feedback${correct ? " correct" : question.question_type === "mcq" ? " incorrect" : ""}`}>
                              {question.question_type === "mcq" ? (
                                <strong>{correct ? "Correct" : "Review this answer"}</strong>
                              ) : (
                                <>
                                  <strong>Model answer</strong>
                                  <p className="exam-student-answer">
                                    <b>Your answer:</b> {examAnswers[index]}
                                  </p>
                                  <div className="exam-self-rate">
                                    <span>How well did your answer cover it?</span>
                                    <label>
                                      <input
                                        type="radio"
                                        name={`exam-rating-${index}`}
                                        checked={examSelfRatings[index] === "mastered"}
                                        onChange={() =>
                                          setExamSelfRatings((ratings) => ({
                                            ...ratings,
                                            [index]: "mastered",
                                          }))
                                        }
                                      />
                                      I knew it
                                    </label>
                                    <label>
                                      <input
                                        type="radio"
                                        name={`exam-rating-${index}`}
                                        checked={examSelfRatings[index] === "revise"}
                                        onChange={() =>
                                          setExamSelfRatings((ratings) => ({
                                            ...ratings,
                                            [index]: "revise",
                                          }))
                                        }
                                      />
                                      Needs revision
                                    </label>
                                  </div>
                                </>
                              )}
                              <p>
                                <strong>Answer:</strong> {question.correct_answer}
                              </p>
                              <p>
                                <strong>Explanation:</strong> {question.explanation}
                              </p>
                            </div>
                          )}
                        </fieldset>
                      );
                    })}
                    {!examPracticeSubmitted ? (
                      <button
                        className="assignment-generate"
                        type="submit"
                        disabled={
                          Object.keys(examAnswers).length !== examQuestions.length
                        }
                      >
                        Submit practice test
                      </button>
                    ) : (
                      <div className="notes-form-actions">
                        <button
                          className="notes-back-button"
                          type="button"
                          onClick={restartExamPractice}
                        >
                          Restart test
                        </button>
                        {examWeakTopics.length > 0 && (
                          <button
                            className="assignment-generate"
                            type="button"
                            onClick={() => generateExamPractice(examWeakTopics)}
                            disabled={examPracticeLoading}
                          >
                            Practice weak topics
                          </button>
                        )}
                      </div>
                    )}
                  </form>
                </>
              )}
            </div>
          </section>
        )}
      </div>
    );
  }

  function renderPresentationPanel() {
    return (
      <div className="notes-panel">
        <div className="notes-heading">
          <p className="eyebrow">BUILD FROM YOUR COURSE MATERIAL</p>
          <h1>Build your Presentation</h1>
          <p>
            Create an editable, source-grounded slide deck from your topic and
            indexed lecture PDFs. Review and edit every slide before downloading.
          </p>
        </div>

        <form
          className="notes-form presentation-form"
          onSubmit={handleGeneratePresentation}
        >
          <ExamDocumentSelector
            title="Optional source PDFs"
            allowTopicOnly
            sources={presentationSources}
            sourcesLoading={presentationSourcesLoading}
            uploading={uploading}
            allDocuments={presentationAllDocuments}
            selectedSources={presentationSelectedSources}
            onAllDocumentsChange={setPresentationAllDocuments}
            onSelectedSourcesChange={setPresentationSelectedSources}
            onFilesSelected={handleFileSelection}
          />
          <label>
            Presentation topic
            <input
              type="text"
              value={presentationTopic}
              onChange={(event) => setPresentationTopic(event.target.value)}
              placeholder="e.g. Neural networks in medical imaging"
              maxLength={300}
              required
            />
          </label>
          <label>
            Number of slides
            <input
              type="number"
              min="3"
              max="20"
              step="1"
              value={presentationSlideCount}
              onChange={(event) => setPresentationSlideCount(event.target.value)}
              required
            />
          </label>
          <label>
            Language
            <select
              value={presentationLanguage}
              onChange={(event) => setPresentationLanguage(event.target.value)}
            >
              {["English", "Urdu", "Arabic", "Spanish", "French", "German", "Turkish", "Chinese"].map((language) => (
                <option key={language}>{language}</option>
              ))}
            </select>
          </label>
          <label>
            Presentation style
            <select
              value={presentationStyle}
              onChange={(event) => setPresentationStyle(event.target.value)}
            >
              {["Academic", "Minimalist", "Storytelling", "Visual"].map((style) => (
                <option key={style}>{style}</option>
              ))}
            </select>
          </label>
          <div className="notes-form-actions">
            <button
              type="submit"
              className="assignment-generate"
              disabled={
                presentationLoading ||
                presentationSourcesLoading ||
                uploading ||
                (presentationAllDocuments && presentationSources.length === 0)
              }
            >
              {presentationLoading ? "Generating slides..." : "Generate presentation"}
            </button>
            <button
              type="button"
              className="notes-back-button"
              onClick={() => {
                setPresentationOpen(false);
                setAssignmentOpen(false);
              }}
            >
              Back to chat
            </button>
          </div>
        </form>

        {renderUploadList()}
        {presentationLoading && (
          <div className="presentation-loading" role="status">
            <progress aria-label="Generating presentation" />
            <span>{presentationStatus}</span>
          </div>
        )}
        {presentationError && (
          <div className="error-message" role="alert">
            <span>⚠</span> {presentationError}
          </div>
        )}
        {presentationStatus && !presentationLoading && !presentationExporting && (
          <p className="notes-status" role="status">{presentationStatus}</p>
        )}
        {presentationExporting && (
          <div className="presentation-loading" role="status">
            <progress aria-label="Exporting PowerPoint file" />
            <span>{presentationStatus}</span>
          </div>
        )}

        {presentationResult && (
          <section className="presentation-result">
            <div className="presentation-result-heading">
              <label>
                Presentation title
                <input
                  type="text"
                  value={presentationResult.title}
                  onChange={(event) =>
                    setPresentationResult((previous) => ({
                      ...previous,
                      title: event.target.value,
                    }))
                  }
                  maxLength={300}
                />
              </label>
              <button
                type="button"
                className="assignment-generate"
                onClick={handleDownloadPresentation}
                disabled={
                  presentationLoading ||
                  presentationExporting ||
                  !presentationResult.title.trim() ||
                  presentationResult.slides.some(
                    (slide) =>
                      !slide.title.trim() ||
                      !slide.explanation.trim() ||
                      !slide.key_points.length
                  )
                }
              >
                {presentationExporting ? "Preparing PowerPoint..." : "Download editable .pptx"}
              </button>
            </div>
            <div className="presentation-workspace">
              <aside className="presentation-preview">
                <p className="eyebrow">SLIDE PREVIEW</p>
                <div className="presentation-preview-card">
                  {presentationResult.slides[presentationPreviewIndex] && (
                    <>
                      <p className="presentation-preview-kicker">
                        {presentationResult.title} · {presentationPreviewIndex + 1} /{" "}
                        {presentationResult.slides.length}
                      </p>
                      <h2>{presentationResult.slides[presentationPreviewIndex].title}</h2>
                      <ul>
                        {presentationResult.slides[presentationPreviewIndex].key_points.map(
                          (point, index) => <li key={`${index}-${point}`}>{point}</li>
                        )}
                      </ul>
                      <p className="presentation-preview-explanation">
                        {presentationResult.slides[presentationPreviewIndex].explanation}
                      </p>
                      {presentationResult.slides[presentationPreviewIndex].example && (
                        <p className="presentation-preview-example">
                          <strong>Example:</strong>{" "}
                          {presentationResult.slides[presentationPreviewIndex].example}
                        </p>
                      )}
                      <p className="presentation-preview-citation">
                        {presentationResult.slides[presentationPreviewIndex].source} ·
                        Page {presentationResult.slides[presentationPreviewIndex].page}
                      </p>
                    </>
                  )}
                </div>
                <div className="presentation-preview-controls">
                  <button
                    type="button"
                    className="notes-back-button"
                    onClick={() =>
                      setPresentationPreviewIndex((index) => Math.max(0, index - 1))
                    }
                    disabled={presentationPreviewIndex === 0}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="notes-back-button"
                    onClick={() =>
                      setPresentationPreviewIndex((index) =>
                        Math.min(presentationResult.slides.length - 1, index + 1)
                      )
                    }
                    disabled={
                      presentationPreviewIndex === presentationResult.slides.length - 1
                    }
                  >
                    Next
                  </button>
                </div>
              </aside>
              <div className="presentation-editors">
                {presentationResult.slides.map((slide, index) => (
                  <article
                    className={`presentation-slide-editor${index === presentationPreviewIndex ? " active" : ""}`}
                    key={`${index}-${slide.source}-${slide.page}`}
                  >
                    <div className="presentation-editor-heading">
                      <h3>Slide {index + 1}</h3>
                      <button
                        type="button"
                        className="notes-back-button"
                        onClick={() => setPresentationPreviewIndex(index)}
                        aria-pressed={index === presentationPreviewIndex}
                      >
                        Preview slide
                      </button>
                    </div>
                    <label>
                      Slide title
                      <input
                        type="text"
                        value={slide.title}
                        onChange={(event) =>
                          updatePresentationSlide(index, "title", event.target.value)
                        }
                        maxLength={200}
                      />
                    </label>
                    <label>
                      Key points (one per line)
                      <textarea
                        value={slide.key_points.join("\n")}
                        onChange={(event) =>
                          updatePresentationKeyPoints(index, event.target.value)
                        }
                        maxLength={1200}
                        rows={4}
                      />
                    </label>
                    <label>
                      Explanation
                      <textarea
                        value={slide.explanation}
                        onChange={(event) =>
                          updatePresentationSlide(index, "explanation", event.target.value)
                        }
                        maxLength={1500}
                        rows={3}
                      />
                    </label>
                    <label>
                      Example
                      <textarea
                        value={slide.example}
                        onChange={(event) =>
                          updatePresentationSlide(index, "example", event.target.value)
                        }
                        maxLength={1000}
                        rows={2}
                      />
                    </label>
                    <p className="presentation-editor-citation">
                      Source: {slide.source} · Page {slide.page}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    );
  }

  function renderResearchPanel() {
    return (
      <div className="notes-panel research-panel">
        <div className="notes-heading">
          <p className="eyebrow">EXPLORE AND ORGANIZE RESEARCH</p>
          <h1>Research Assistant</h1>
          <p>
            Build a source-cited research draft and analyze selected papers.
            Review every claim and complete missing publication details before use.
          </p>
        </div>

        <div className="research-integrity-notice" role="note">
          <strong>AI-generated suggestions are not verified findings.</strong>
          <span>
            Generated summaries cite passages from your selected PDFs; UniAssist
            does not independently verify results or publication metadata. Check
            claims against the original papers.
          </span>
        </div>

        <form className="notes-form research-form" onSubmit={handleGenerateResearch}>
          <ExamDocumentSelector
            title="Research papers and documents"
            sources={researchSources}
            sourcesLoading={researchSourcesLoading}
            uploading={uploading}
            allDocuments={researchAllDocuments}
            selectedSources={researchSelectedSources}
            onAllDocumentsChange={setResearchAllDocuments}
            onSelectedSourcesChange={setResearchSelectedSources}
            onFilesSelected={handleFileSelection}
            maxSelectedSources={12}
          />
          <label className="research-topic-field">
            Research topic or question
            <textarea
              value={researchTopic}
              onChange={(event) => setResearchTopic(event.target.value)}
              placeholder="e.g. How does spaced practice affect undergraduate retention?"
              maxLength={1000}
              rows={3}
              required
            />
          </label>
          <label>
            Citation style
            <select
              value={researchCitationStyle}
              onChange={(event) => setResearchCitationStyle(event.target.value)}
            >
              <option>APA</option>
              <option>MLA</option>
              <option>IEEE</option>
            </select>
          </label>
          <div className="notes-form-actions">
            <button
              type="submit"
              className="assignment-generate"
              disabled={
                researchLoading ||
                researchSourcesLoading ||
                uploading ||
                (!researchAllDocuments &&
                  researchSelectedSources.length > 12)
              }
            >
              {researchLoading ? "Analyzing research papers..." : "Generate research draft"}
            </button>
            <button
              type="button"
              className="notes-back-button"
              onClick={() => {
                setResearchOpen(false);
                setAssignmentOpen(false);
              }}
            >
              Back to chat
            </button>
          </div>
        </form>

        {renderUploadList()}
        {researchLoading && (
          <div className="presentation-loading" role="status">
            <progress aria-label="Generating research draft" />
            <span>{researchStatus}</span>
          </div>
        )}
        {researchError && (
          <div className="error-message" role="alert">
            <span>⚠</span> {researchError}
          </div>
        )}
        {researchStatus && !researchLoading && !researchExporting && (
          <p className="notes-status" role="status">{researchStatus}</p>
        )}
        {researchExporting && (
          <div className="presentation-loading" role="status">
            <progress aria-label="Exporting research document" />
            <span>{researchStatus}</span>
          </div>
        )}

        {researchContent && (
          <section className="notes-result research-result">
            <div className="notes-result-heading">
              <div>
                <h2>{researchTitle}</h2>
                <p>
                  AI-generated draft · Citation style: {researchCitationStyle}
                </p>
              </div>
              <div className="notes-actions">
                <button
                  type="button"
                  className="notes-edit-button"
                  onClick={() => setResearchEditing((editing) => !editing)}
                >
                  {researchEditing ? "Preview research" : "Edit research"}
                </button>
                <button
                  type="button"
                  className="copy-draft-button"
                  onClick={handleCopyResearch}
                >
                  Copy research
                </button>
                <button
                  type="button"
                  className="download-pdf-button"
                  onClick={() => handleDownloadResearch("pdf")}
                  disabled={researchExporting}
                >
                  Download PDF
                </button>
                <button
                  type="button"
                  className="download-pdf-button"
                  onClick={() => handleDownloadResearch("docx")}
                  disabled={researchExporting}
                >
                  Download DOCX
                </button>
              </div>
            </div>
            {researchEditing ? (
              <textarea
                className="notes-editor"
                aria-label="Editable research content"
                value={researchContent}
                onChange={(event) => {
                  setResearchContent(event.target.value);
                  setResearchStatus("");
                }}
              />
            ) : (
              <div className="notes-preview message-content">
                <ChatMarkdown content={researchContent} />
              </div>
            )}
            <div className="research-integrity-notice research-result-notice">
              <strong>Verify before citing.</strong>
              <span>
                Reference details are extracted only when printed in the indexed
                PDFs; missing details use the filename and “n.d.”. Verify
                bibliographic details and findings in the original papers.
              </span>
            </div>
            <div className="notes-sources">
              <strong>Sources used</strong>
              <ul>
                {researchUsedSources.map((source) => (
                  <li key={source}>{source}</li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </div>
    );
  }

  function renderNotesPanel() {
    return (
      <div className="notes-panel">
        <div className="notes-heading">
          <p className="eyebrow">STUDY FROM YOUR LECTURES</p>
          <h1>Notes Generator</h1>
          <p>
            Generate source-grounded study notes from the lecture PDFs you
            choose. Edit the result, copy it, or download a PDF.
          </p>
        </div>

        <form className="notes-form" onSubmit={handleGenerateNotes}>
          <DocumentSelector
            id="notes"
            selectedSource={notesSelectedSource}
            sources={notesSources}
            sourcesLoading={notesSourcesLoading}
            uploading={uploading}
            onSourceChange={setNotesSelectedSource}
            onFilesSelected={handleFileSelection}
          />
          <label>
            Notes style
            <select
              value={notesType}
              onChange={(event) => setNotesType(event.target.value)}
            >
              <option value="short">Short notes</option>
              <option value="detailed">Detailed notes</option>
              <option value="topic_wise">Topic-wise notes</option>
            </select>
          </label>
          <div className="notes-form-actions">
            <button
              type="submit"
              className="assignment-generate"
              disabled={
                notesLoading ||
                notesSourcesLoading ||
                notesSources.length === 0
              }
            >
              {notesLoading ? "Generating notes..." : "Generate notes"}
            </button>
            <button
              type="button"
              className="notes-back-button"
              onClick={() => {
                setNotesOpen(false);
                setAssignmentOpen(false);
              }}
            >
              Back to chat
            </button>
          </div>
        </form>

        {renderUploadList()}
        {notesSourcesLoading && (
          <p className="notes-status" role="status">
            Loading available lecture PDFs...
          </p>
        )}
        {notesLoading && (
          <p className="notes-status" role="status">
            Reviewing selected lecture content and preparing your notes...
          </p>
        )}
        {notesError && (
          <div className="error-message" role="alert">
            <span>⚠</span> {notesError}
          </div>
        )}
        {notesStatus && !notesLoading && (
          <p className="notes-status" role="status">{notesStatus}</p>
        )}
        {notesContent && (
          <section className="notes-result">
            <div className="notes-result-heading">
              <div>
                <h2>{notesTitle || "Study notes"}</h2>
                <p>
                  Edit these notes as needed. Generated content is based on the
                  selected indexed PDFs.
                </p>
              </div>
              <div className="notes-actions">
                <button
                  type="button"
                  className="notes-edit-button"
                  onClick={() => setNotesEditing((editing) => !editing)}
                >
                  {notesEditing ? "Preview notes" : "Edit notes"}
                </button>
                <button
                  type="button"
                  className="copy-draft-button"
                  onClick={handleCopyNotes}
                >
                  Copy notes
                </button>
                <button
                  type="button"
                  className="download-pdf-button"
                  onClick={handleDownloadNotesPdf}
                  disabled={notesPdfExporting}
                >
                  {notesPdfExporting ? "Creating PDF..." : "Download PDF"}
                </button>
              </div>
            </div>
            {notesEditing ? (
              <textarea
                className="notes-editor"
                aria-label="Generated study notes"
                value={notesContent}
                onChange={(event) => {
                  setNotesContent(event.target.value);
                  setNotesStatus("");
                }}
              />
            ) : (
              <div className="notes-preview message-content">
                <ChatMarkdown content={notesContent} />
              </div>
            )}
            <div className="notes-sources">
              <strong>Selected lecture documents</strong>
              <ul>
                {notesUsedSources.map((source) => (
                  <li key={source}>{source}</li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </div>
    );
  }

  function renderQuizPanel() {
    const score = scoreQuiz(quizQuestions, quizAnswers);

    return (
      <div className="quiz-panel">
        <div className="notes-heading">
          <p className="eyebrow">PRACTICE FROM YOUR LECTURES</p>
          <h1>Quiz Generator</h1>
          <p>
            Create a quiz grounded in your selected indexed PDFs, then submit
            your answers to review your score and explanations.
          </p>
        </div>

        <form className="notes-form quiz-form" onSubmit={handleGenerateQuiz}>
          <DocumentSelector
            id="quiz"
            selectedSource={quizSelectedSource}
            sources={quizSources}
            sourcesLoading={quizSourcesLoading}
            uploading={uploading}
            onSourceChange={setQuizSelectedSource}
            onFilesSelected={handleFileSelection}
          />
          <label>
            Number of questions
            <input
              type="number"
              min="3"
              max="20"
              step="1"
              required
              value={quizQuestionCount}
              onChange={(event) => setQuizQuestionCount(event.target.value)}
            />
          </label>
          <label>
            Difficulty
            <select
              value={quizDifficulty}
              onChange={(event) => setQuizDifficulty(event.target.value)}
            >
              <option>Easy</option>
              <option>Medium</option>
              <option>Hard</option>
            </select>
          </label>
          <div className="notes-form-actions">
            <button
              type="submit"
              className="assignment-generate"
              disabled={
                quizLoading ||
                quizSourcesLoading ||
                quizSources.length === 0
              }
            >
              {quizLoading ? "Generating quiz..." : "Generate quiz"}
            </button>
            <button
              type="button"
              className="notes-back-button"
              onClick={() => {
                setQuizOpen(false);
                setAssignmentOpen(false);
              }}
            >
              Back to chat
            </button>
          </div>
        </form>

        {renderUploadList()}
        {quizSourcesLoading && (
          <p className="notes-status" role="status">
            Loading available lecture PDFs...
          </p>
        )}
        {quizLoading && (
          <p className="notes-status" role="status">
            Reviewing selected lecture content and preparing your quiz...
          </p>
        )}
        {quizError && (
          <div className="error-message" role="alert">
            <span>⚠</span> {quizError}
          </div>
        )}
        {quizStatus && !quizLoading && (
          <p className="notes-status" role="status">{quizStatus}</p>
        )}
        {quizQuestions.length > 0 && (
          <>
            {quizSubmitted && (
              <section className="quiz-score" aria-live="polite">
                <h2>Your score: {score} / {quizQuestions.length}</h2>
                <p>{quizUsedDifficulty} quiz · {quizSourcesUsed.join(", ")}</p>
              </section>
            )}
            <form className="quiz-questions" onSubmit={submitQuiz}>
              {quizQuestions.map((question, index) => {
                const isCorrect = isQuizAnswerCorrect(question, quizAnswers[index]);
                const choices =
                  question.question_type === "true_false"
                    ? ["True", "False"]
                    : question.options;

                return (
                  <fieldset className="quiz-question" key={`${index}-${question.question}`}>
                    <legend>
                      Question {index + 1} · {
                        question.question_type === "mcq"
                          ? "Multiple choice"
                          : question.question_type === "true_false"
                            ? "True or false"
                            : "Short answer"
                      }
                    </legend>
                    <p>{question.question}</p>
                    {question.question_type === "short_answer" ? (
                      <input
                        type="text"
                        aria-label={`Answer to question ${index + 1}`}
                        value={quizAnswers[index] || ""}
                        onChange={(event) =>
                          setQuizAnswers((answers) => ({
                            ...answers,
                            [index]: event.target.value,
                          }))
                        }
                        disabled={quizSubmitted}
                        required={!quizSubmitted}
                        maxLength={1000}
                      />
                    ) : (
                      <div className="quiz-options">
                        {choices.map((choice) => (
                          <label key={choice}>
                            <input
                              type="radio"
                              name={`quiz-question-${index}`}
                              value={choice}
                              checked={quizAnswers[index] === choice}
                              onChange={() =>
                                setQuizAnswers((answers) => ({
                                  ...answers,
                                  [index]: choice,
                                }))
                              }
                              disabled={quizSubmitted}
                              required={!quizSubmitted}
                            />
                            <span>{choice}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <p className="quiz-citation">
                      Source: {question.source} · Page {question.page}
                    </p>
                    {quizSubmitted && (
                      <div className={`quiz-feedback${isCorrect ? " correct" : " incorrect"}`}>
                        <strong>{isCorrect ? "Correct" : "Not quite"}</strong>
                        <p>
                          <strong>Correct answer:</strong> {question.correct_answer}
                        </p>
                        <p>
                          <strong>Explanation:</strong> {question.explanation}
                        </p>
                      </div>
                    )}
                  </fieldset>
                );
              })}
              {!quizSubmitted ? (
                <button
                  className="assignment-generate"
                  type="submit"
                  disabled={Object.keys(quizAnswers).length !== quizQuestions.length}
                >
                  Submit answers
                </button>
              ) : (
                <div className="notes-form-actions">
                  <button
                    className="notes-back-button"
                    type="button"
                    onClick={restartQuiz}
                  >
                    Restart quiz
                  </button>
                  <button
                    className="assignment-generate"
                    type="button"
                    onClick={generateAnotherQuiz}
                  >
                    Generate another quiz
                  </button>
                </div>
              )}
            </form>
          </>
        )}
      </div>
    );
  }

  async function handleCopyNotes() {
    try {
      await navigator.clipboard.writeText(notesContent);
      setNotesStatus("Notes copied to clipboard.");
      setNotesError("");
    } catch {
      setNotesError("Could not copy notes. Select the text and copy it manually.");
    }
  }

  async function handleDownloadNotesPdf() {
    setNotesPdfExporting(true);
    setNotesError("");
    setNotesStatus("");
    try {
      const pdf = await downloadNotesPdf({
        title: notesTitle || "Lecture study notes",
        notes: notesContent,
        sources: notesUsedSources,
      });
      const downloadUrl = URL.createObjectURL(pdf);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "uniassist-study-notes.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setNotesStatus("Notes PDF downloaded.");
    } catch (exportError) {
      setNotesError(exportError.message);
    } finally {
      setNotesPdfExporting(false);
    }
  }

  function handleLogoSelection(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setCoverError("");
    setCoverStatus("");

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
          references: assignmentSources.map((source) => ({
            source: source.source,
            page: String(source.page),
          })),
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
    const files = Array.isArray(event) ? event : Array.from(event.target.files || []);
    if (!Array.isArray(event)) event.target.value = "";
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
        status: uploadError ? "Failed" : "Queued",
        progress: 0,
        error: uploadError,
      };
    });

    setUploads((previous) => [...selectedUploads, ...previous]);

    try {
      let indexedAny = false;
      const indexedSources = [];
      for (const upload of selectedUploads) {
        if (upload.error) continue;

        try {
          setUploads((previous) =>
            previous.map((item) =>
              item.id === upload.id
                ? { ...item, status: "Uploading" }
                : item
            )
          );
          const data = await uploadPdf(upload.file, (progress) => {
            setUploads((previous) =>
              previous.map((item) =>
                item.id === upload.id
                  ? {
                      ...item,
                      progress,
                      status: progress === 100 ? "Indexing" : "Uploading",
                    }
                  : item
              )
            );
          });

          setUploads((previous) =>
            previous.map((item) =>
              item.id === upload.id
                ? { ...item, progress: 100, status: "Indexed", error: "" }
                : item
            )
          );
          indexedAny = true;
          indexedSources.push(data.filename || upload.file.name);
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
      if (indexedAny) {
        if (indexedSources.length === 1) {
          setNotesSelectedSource(indexedSources[0]);
          setQuizSelectedSource(indexedSources[0]);
        }
        if (presentationOpen) {
          setPresentationAllDocuments(false);
          setPresentationSelectedSources((previous) =>
            [...new Set([...previous, ...indexedSources])]
          );
        }
        if (researchOpen) {
          setResearchAllDocuments(false);
          setResearchSelectedSources((previous) =>
            [...new Set([...previous, ...indexedSources])].slice(0, 12)
          );
        }
        setExamSelectedSources((previous) =>
          [...new Set([...previous, ...indexedSources])]
        );
        const [
          notesResult,
          quizResult,
          examResult,
          presentationResult,
          researchResult,
        ] = await Promise.allSettled([
          listNotesSources(),
          listQuizSources(),
          listExamSources(),
          listPresentationSources(),
          listResearchSources(),
        ]);
        if (notesResult.status === "fulfilled") {
          setNotesSources(notesResult.value);
          setNotesError("");
        } else if (notesOpen) {
          setNotesError(
            `The PDF was indexed, but the notes document list could not be refreshed: ${notesResult.reason.message}`
          );
        }
        if (quizResult.status === "fulfilled") {
          setQuizSources(quizResult.value);
          setQuizError("");
        } else if (quizOpen) {
          setQuizError(
            `The PDF was indexed, but the quiz document list could not be refreshed: ${quizResult.reason.message}`
          );
        }
        if (examResult.status === "fulfilled") {
          setExamSources(examResult.value);
          setExamPlanError("");
        } else if (examOpen) {
          setExamPlanError(
            `The PDF was indexed, but the exam document list could not be refreshed: ${examResult.reason.message}`
          );
        }
        if (presentationResult.status === "fulfilled") {
          setPresentationSources(presentationResult.value);
          setPresentationError("");
        } else if (presentationOpen) {
          setPresentationError(
            `The PDF was indexed, but the presentation document list could not be refreshed: ${presentationResult.reason.message}`
          );
        }
        if (researchResult.status === "fulfilled") {
          setResearchSources(researchResult.value);
          setResearchError("");
        } else if (researchOpen) {
          setResearchError(
            `The PDF was indexed, but the research document list could not be refreshed: ${researchResult.reason.message}`
          );
        }
        setSuggestionsLoading(true);
        await refreshSuggestions();
      }
    } finally {
      setUploading(false);
    }
  }

  function renderUploadList() {
    if (uploads.length === 0) return null;

    return (
      <div className="upload-list" aria-live="polite">
        {uploads.map((upload) => (
          <div
            className={`upload-item upload-${upload.status.toLowerCase()}`}
            key={upload.id}
          >
            <span className="upload-filename">{upload.file.name}</span>
            <span className="upload-status">
              {upload.status === "Indexed"
                ? "Uploaded and indexed"
                : upload.status}
            </span>
            {upload.status !== "Failed" && upload.status !== "Indexed" && (
              <progress
                className="upload-progress"
                value={upload.progress}
                max="100"
                aria-label={`Upload progress for ${upload.file.name}`}
              />
            )}
            {upload.error && (
              <span className="upload-error" role="alert">
                {upload.error}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  async function handleNewChat() {
    const timestamp = Date.now();
    const chat = {
      id: createChatId(),
      title: "New chat",
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    activeChatIdRef.current = chat.id;
    setActiveChatId(chat.id);
    setMessages([]);
    setQuestion("");
    setError("");
    setLoading(false);
    setAssignmentOpen(false);
    setPresentationOpen(false);
    setResearchOpen(false);
    setChatHistoryError("");
    setChatHistoryStatus("");
    try {
      const savedChat = await createConversation(chat);
      setChats((previous) => [
        savedChat,
        ...previous.filter((existing) => existing.id !== savedChat.id),
      ]);
    } catch (historyError) {
      setChatHistoryError(
        `Could not create a conversation: ${historyError.message}`
      );
    }
  }

  async function handleOpenChat(chat) {
    activeChatIdRef.current = chat.id;
    setActiveChatId(chat.id);
    setMessages([]);
    setQuestion("");
    setError("");
    setChatHistoryError("");
    setChatHistoryStatus("");
    setLoading(false);
    setAssignmentOpen(false);
    setPresentationOpen(false);
    setResearchOpen(false);
    try {
      const loadedChat = await getConversation(chat.id);
      if (activeChatIdRef.current === chat.id) {
        setMessages(loadedChat.messages);
      }
    } catch (historyError) {
      setChatHistoryError(`Could not load this conversation: ${historyError.message}`);
    }
  }

  async function handleDeleteChat(chatId) {
    setDeletingChatId(chatId);
    setChatHistoryError("");
    setChatHistoryStatus("");

    try {
      await deleteConversation(chatId);
      const remainingChats = chats.filter((chat) => chat.id !== chatId);
      setChats(remainingChats);

      if (activeChatIdRef.current === chatId) {
        const nextChat = remainingChats[0] || null;
        activeChatIdRef.current = nextChat?.id || null;
        setActiveChatId(nextChat?.id || null);
        setMessages([]);
        setQuestion("");
        setError("");
        setLoading(false);
        if (nextChat) {
          const loadedChat = await getConversation(nextChat.id);
          if (activeChatIdRef.current === nextChat.id) {
            setMessages(loadedChat.messages);
          }
        }
      }
    } catch (historyError) {
      setChatHistoryError(
        `Could not update chat history: ${historyError.message}`
      );
    } finally {
      setDeletingChatId(null);
    }
  }

  async function handleRenameChat(chat) {
    const title = window.prompt("Enter a new conversation name:", chat.title);
    if (title === null || !title.trim()) return;

    setRenamingChatId(chat.id);
    setChatHistoryError("");
    setChatHistoryStatus("");
    try {
      const renamedChat = await renameConversation(chat.id, title.trim());
      setChats((previous) =>
        previous.map((item) =>
          item.id === renamedChat.id ? { ...item, title: renamedChat.title } : item
        )
      );
    } catch (historyError) {
      setChatHistoryError(`Could not rename this conversation: ${historyError.message}`);
    } finally {
      setRenamingChatId(null);
    }
  }

  async function handleExportBrowserHistory() {
    setExportingBrowserHistory(true);
    setChatHistoryError("");
    setChatHistoryStatus("");
    try {
      const { chats: browserChats, migrationError } = await readChatHistory();
      if (migrationError) {
        throw migrationError;
      }
      if (browserChats.length === 0) {
        setChatHistoryStatus("No existing browser-stored conversations were found.");
        return;
      }

      const archive = {
        format: "UniAssist chat history export",
        version: 1,
        exportedAt: new Date().toISOString(),
        conversations: browserChats,
      };
      const blob = new Blob([JSON.stringify(archive, null, 2)], {
        type: "application/json",
      });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `uniassist-chat-history-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setChatHistoryStatus(
        `Exported ${browserChats.length} browser-stored conversation(s). The original browser history was not deleted.`
      );
    } catch (historyError) {
      setChatHistoryError(
        `Could not export browser history: ${describeStorageFailure(historyError)}`
      );
    } finally {
      setExportingBrowserHistory(false);
    }
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

        <button
          className="new-chat-button"
          onClick={handleNewChat}
          disabled={!chatHistoryLoaded}
        >
          <span>＋</span> New chat
        </button>

        <div className="sidebar-label">CHAT HISTORY</div>
        <div className="chat-history" aria-label="Previous conversations">
          {!chatHistoryLoaded ? (
            <p className="chat-history-empty" role="status">
              Loading conversations...
            </p>
          ) : chats.length === 0 ? (
            <p className="chat-history-empty">Your conversations will appear here.</p>
          ) : (
            chats.map((chat) => (
              <div
                className={`chat-history-item${chat.id === activeChatId ? " active" : ""}`}
                key={chat.id}
              >
                <button
                  type="button"
                  className="chat-history-open"
                  onClick={() => handleOpenChat(chat)}
                  disabled={deletingChatId === chat.id}
                  title={chat.title}
                  aria-current={chat.id === activeChatId ? "page" : undefined}
                >
                  {chat.title}
                </button>
                <button
                  type="button"
                  className="chat-history-rename"
                  onClick={() => handleRenameChat(chat)}
                  disabled={
                    deletingChatId === chat.id || renamingChatId === chat.id
                  }
                  aria-label={`Rename ${chat.title}`}
                  title="Rename conversation"
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="chat-history-delete"
                  onClick={() => handleDeleteChat(chat.id)}
                  disabled={
                    deletingChatId === chat.id || renamingChatId === chat.id
                  }
                  aria-label={`Delete ${chat.title}`}
                  title="Delete conversation"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
        <button
          className="chat-history-export"
          type="button"
          onClick={handleExportBrowserHistory}
          disabled={exportingBrowserHistory}
        >
          {exportingBrowserHistory
            ? "Exporting browser history..."
            : "Export old browser history"}
        </button>
        {chatHistoryStatus && (
          <p className="chat-history-status" role="status">
            {chatHistoryStatus}
          </p>
        )}

        <div className="sidebar-label">ACADEMIC PRODUCTIVITY</div>
        <div className="sidebar-tools">
          <button
            type="button"
            className={`sidebar-tool-button${notesOpen ? " active" : ""}`}
            onClick={openNotesGenerator}
            aria-current={notesOpen ? "page" : undefined}
          >
            <span>✧</span> Notes Generator
          </button>
          <button
            type="button"
            className={`sidebar-tool-button${quizOpen ? " active" : ""}`}
            onClick={openQuizGenerator}
            aria-current={quizOpen ? "page" : undefined}
          >
            <span>✓</span> Quiz Generator
          </button>
          <button
            type="button"
            className={`sidebar-tool-button${examOpen ? " active" : ""}`}
            onClick={openExamPreparation}
            aria-current={examOpen ? "page" : undefined}
          >
            <span>▣</span> Exam Preparation
          </button>
          <button
            type="button"
            className={`sidebar-tool-button${presentationOpen ? " active" : ""}`}
            onClick={openPresentationBuilder}
            aria-current={presentationOpen ? "page" : undefined}
          >
            <span>▤</span> Build your Presentation
          </button>
          <button
            type="button"
            className={`sidebar-tool-button${researchOpen ? " active" : ""}`}
            onClick={openResearchAssistant}
            aria-current={researchOpen ? "page" : undefined}
          >
            <span>⌕</span> Research Assistant
          </button>
        </div>

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

      <main
        className={`main-panel${!assignmentOpen && !notesOpen && !quizOpen && !examOpen && !presentationOpen && !researchOpen && messages.length === 0 ? " main-panel-welcome" : ""}`}
      >
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
          <select
            className="mobile-study-tool"
            aria-label="Study tool"
            value={
              notesOpen
                ? "notes"
                : quizOpen
                  ? "quiz"
                  : examOpen
                    ? "exam"
                      : presentationOpen
                        ? "presentation"
                      : researchOpen
                        ? "research"
                        : ""
            }
            onChange={(event) => {
              if (event.target.value === "notes") {
                openNotesGenerator();
              } else if (event.target.value === "quiz") {
                openQuizGenerator();
              } else if (event.target.value === "exam") {
                openExamPreparation();
              } else if (event.target.value === "presentation") {
                openPresentationBuilder();
              } else if (event.target.value === "research") {
                openResearchAssistant();
              } else {
                setNotesOpen(false);
                setQuizOpen(false);
                setExamOpen(false);
                setPresentationOpen(false);
                setResearchOpen(false);
                setAssignmentOpen(false);
              }
            }}
          >
            <option value="">Chat</option>
            <option value="notes">Notes</option>
            <option value="quiz">Quiz</option>
            <option value="exam">Exam Prep</option>
            <option value="presentation">Presentation</option>
            <option value="research">Research</option>
          </select>
          <button
            className="assignment-toggle"
            type="button"
            onClick={toggleAssignment}
          >
            {assignmentOpen ? "Back to Chat" : "Assignment Assistant"}
          </button>
        </header>

        <section className="chat-area">
          {!assignmentOpen && chatHistoryError && (
            <div className="chat-history-error" role="alert">
              <span>{chatHistoryError}</span>
              <button
                type="button"
                onClick={() => setChatHistoryError("")}
                aria-label="Dismiss chat history error"
              >
                ×
              </button>
            </div>
          )}
          {assignmentOpen ? (
            <div className={notesOpen || quizOpen || examOpen || presentationOpen || researchOpen ? "study-tools-shell" : "assignment-panel"}>
              {!notesOpen && !quizOpen && !examOpen && !presentationOpen && !researchOpen && (
                <>
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
                  <div className="cover-default-actions">
                    <button
                      type="button"
                      className="save-cover-details"
                      onClick={saveCoverDefaults}
                      disabled={coverSaving}
                    >
                      {coverSaving ? "Saving..." : "Save Details"}
                    </button>
                    <button
                      type="button"
                      className="reset-cover-details"
                      onClick={resetCoverDefaults}
                      disabled={coverSaving}
                    >
                      Reset Details
                    </button>
                    {coverStatus && (
                      <p className="cover-status" role="status">{coverStatus}</p>
                    )}
                  </div>
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
                </>
              )}

              {assignmentDraft && !notesOpen && !quizOpen && !examOpen && !presentationOpen && !researchOpen ? (
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
                  <div className="sources-panel">
                    <strong>References</strong>
                    {assignmentSources.length > 0 ? (
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
                    ) : notesOpen ? (
                      <div className="notes-panel">
                        <div className="notes-heading">
                          <p className="eyebrow">STUDY FROM YOUR LECTURES</p>
                          <h1>Notes Generator</h1>
                          <p>
                            Generate source-grounded study notes from the lecture PDFs
                            you choose. Edit the result, copy it, or download a PDF.
                          </p>
                        </div>

                        <form className="notes-form" onSubmit={handleGenerateNotes}>
                          <label>
                            Lecture document
                            <select
                              value={notesSelectedSource}
                              onChange={(event) => setNotesSelectedSource(event.target.value)}
                              disabled={notesSourcesLoading || notesSources.length === 0}
                            >
                              <option value="all">All available lecture documents</option>
                              {notesSources.map((source) => (
                                <option key={source} value={source}>{source}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Notes style
                            <select
                              value={notesType}
                              onChange={(event) => setNotesType(event.target.value)}
                            >
                              <option value="short">Short notes</option>
                              <option value="detailed">Detailed notes</option>
                              <option value="topic_wise">Topic-wise notes</option>
                            </select>
                          </label>
                          <div className="notes-form-actions">
                            <button
                              type="submit"
                              className="assignment-generate"
                              disabled={
                                notesLoading ||
                                notesSourcesLoading ||
                                notesSources.length === 0
                              }
                            >
                              {notesLoading ? "Generating notes..." : "Generate notes"}
                            </button>
                            <button
                              type="button"
                              className="notes-back-button"
                              onClick={() => setNotesOpen(false)}
                            >
                              Back to chat
                            </button>
                          </div>
                        </form>

                        {notesSourcesLoading && (
                          <p className="notes-status" role="status">
                            Loading available lecture PDFs...
                          </p>
                        )}
                        {notesLoading && (
                          <p className="notes-status" role="status">
                            Reviewing selected lecture content and preparing your notes...
                          </p>
                        )}
                        {notesError && (
                          <div className="error-message" role="alert">
                            <span>⚠</span> {notesError}
                          </div>
                        )}
                        {notesStatus && !notesLoading && (
                          <p className="notes-status" role="status">{notesStatus}</p>
                        )}
                        {notesContent && (
                          <section className="notes-result">
                            <div className="notes-result-heading">
                              <div>
                                <h2>{notesTitle || "Study notes"}</h2>
                                <p>
                                  Edit these notes as needed. Generated content is based
                                  on the selected indexed PDFs.
                                </p>
                              </div>
                              <div className="notes-actions">
                                <button
                                  type="button"
                                  className="notes-edit-button"
                                  onClick={() => setNotesEditing((editing) => !editing)}
                                >
                                  {notesEditing ? "Preview notes" : "Edit notes"}
                                </button>
                                <button
                                  type="button"
                                  className="copy-draft-button"
                                  onClick={handleCopyNotes}
                                >
                                  Copy notes
                                </button>
                                <button
                                  type="button"
                                  className="download-pdf-button"
                                  onClick={handleDownloadNotesPdf}
                                  disabled={notesPdfExporting}
                                >
                                  {notesPdfExporting ? "Creating PDF..." : "Download PDF"}
                                </button>
                              </div>
                            </div>
                            {notesEditing ? (
                              <textarea
                                className="notes-editor"
                                aria-label="Generated study notes"
                                value={notesContent}
                                onChange={(event) => {
                                  setNotesContent(event.target.value);
                                  setNotesStatus("");
                                }}
                              />
                            ) : (
                              <div className="notes-preview message-content">
                                <ChatMarkdown content={notesContent} />
                              </div>
                            )}
                            <div className="notes-sources">
                              <strong>Selected lecture documents</strong>
                              <ul>
                                {notesUsedSources.map((source) => (
                                  <li key={source}>{source}</li>
                                ))}
                              </ul>
                            </div>
                          </section>
                        )}
                      </div>
                    ) : (
                      <p className="assignment-no-sources">
                        No relevant uploaded material was found for this subject
                        and topic.
                      </p>
                    )}
                  </div>
                </section>
              ) : notesOpen ? (
                renderNotesPanel()
              ) : quizOpen ? (
                renderQuizPanel()
              ) : examOpen ? (
                renderExamPanel()
              ) : presentationOpen ? (
                renderPresentationPanel()
              ) : researchOpen ? (
                renderResearchPanel()
              ) : null}
            </div>
          ) : (
            <>
          {messages.length === 0 ? (
            <div className="welcome-screen">
              <p className="eyebrow">YOUR CAMPUS, YOUR KNOWLEDGE</p>
              <h1>What would you like to <span>learn today?</span></h1>
              <p className="welcome-description">
                Ask questions about your university lecture notes.
                Get clear explanations grounded in your study materials.
              </p>

              <div className="suggestion-grid">
                {suggestionsLoading && suggestions.length === 0
                  ? Array.from({ length: 4 }, (_, index) => (
                      <button
                        className="suggestion-card suggestion-card-loading"
                        key={`suggestion-loading-${index}`}
                        disabled
                        aria-label="Loading study suggestions"
                      >
                        <span className="suggestion-icon">
                          {SUGGESTION_ICONS[index]}
                        </span>
                        <span>
                          <strong>Finding suggestions</strong>
                          <small>Reviewing indexed PDFs…</small>
                        </span>
                      </button>
                    ))
                  : suggestions.map((item, index) => (
                  <button
                    className="suggestion-card"
                    key={`${item.question}-${index}`}
                    onClick={() => sendMessage(item.question)}
                    disabled={loading}
                  >
                    <span className="suggestion-icon">
                      {SUGGESTION_ICONS[index % SUGGESTION_ICONS.length]}
                    </span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.question}</small>
                    </span>
                    <span className="suggestion-arrow">↗</span>
                  </button>
                  ))}
              </div>
              {suggestionsMessage && (
                <p className="suggestion-status" role="status">
                  {suggestionsMessage}
                  {suggestions.length === 0 && !suggestionsLoading && (
                            <button
                              type="button"
                              onClick={() => {
                                setSuggestionsLoading(true);
                                refreshSuggestions();
                              }}
                            >
                              Retry
                            </button>
                  )}
                </p>
              )}
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
                      {message.role === "assistant" ? (
                        <ChatMarkdown content={message.content} />
                      ) : (
                        message.content
                      )}
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

        {!assignmentOpen && !notesOpen && <footer className="composer-area">
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

          {renderUploadList()}

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
/* eslint-disable react-refresh/only-export-components */
export {
  createChatHistory,
  deleteChatHistory,
  openChatHistoryDb,
  readChatHistory,
  saveChatMessage,
};
/* eslint-enable react-refresh/only-export-components */
