const UPLOAD_URL = "http://127.0.0.1:8000/api/upload";

export function uploadPdf(file, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);

    request.open("POST", UPLOAD_URL);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      let data;
      try {
        data = JSON.parse(request.responseText);
      } catch {
        data = {};
      }
      if (!data || typeof data !== "object") {
        data = {};
      }

      if (request.status >= 200 && request.status < 300) {
        resolve(data);
        return;
      }

      reject(
        new Error(
          (data && data.detail) ||
            `Upload failed with status ${request.status}.`
        )
      );
    });
    request.addEventListener("error", () => {
      reject(
        new Error(
          "Could not connect to the upload service. Make sure FastAPI is running."
        )
      );
    });
    request.addEventListener("abort", () => {
      reject(new Error("The PDF upload was cancelled."));
    });
    request.send(formData);
  });
}
