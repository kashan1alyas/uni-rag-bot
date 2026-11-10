import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { uploadPdf } from "../src/uploadApi.js";

const originalXMLHttpRequest = globalThis.XMLHttpRequest;

class MockXMLHttpRequest {
  listeners = {};
  upload = {
    addEventListener: (type, callback) => {
      this.uploadProgress = callback;
    },
  };
  status = 0;
  responseText = "";

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  addEventListener(type, callback) {
    this.listeners[type] = callback;
  }

  send(body) {
    this.body = body;
  }

  complete(status, responseText) {
    this.status = status;
    this.responseText = responseText;
    this.listeners.load();
  }
}

afterEach(() => {
  globalThis.XMLHttpRequest = originalXMLHttpRequest;
});

test("upload API reports transfer progress and the indexed document", async () => {
  let request;
  globalThis.XMLHttpRequest = class extends MockXMLHttpRequest {
    constructor() {
      super();
      request = this;
    }
  };
  const progress = [];
  const resultPromise = uploadPdf(new Blob(["pdf"]), (value) => {
    progress.push(value);
  });

  assert.equal(request.method, "POST");
  assert.equal(request.url, "http://127.0.0.1:8000/api/upload");
  assert.equal(request.body.get("file").size, 3);
  request.uploadProgress({ lengthComputable: true, loaded: 2, total: 4 });
  request.complete(
    200,
    JSON.stringify({ filename: "lecture.pdf", chunks_added: 2 })
  );

  assert.deepEqual(progress, [50]);
  assert.deepEqual(await resultPromise, {
    filename: "lecture.pdf",
    chunks_added: 2,
  });
});

test("upload API reports server errors and connection failures", async () => {
  let request;
  globalThis.XMLHttpRequest = class extends MockXMLHttpRequest {
    constructor() {
      super();
      request = this;
    }
  };

  const serverError = uploadPdf(new Blob(["pdf"]));
  request.complete(422, JSON.stringify({ detail: "No readable text." }));
  await assert.rejects(serverError, /No readable text/);

  const connectionError = uploadPdf(new Blob(["pdf"]));
  request.listeners.error();
  await assert.rejects(connectionError, /Could not connect to the upload service/);
});
