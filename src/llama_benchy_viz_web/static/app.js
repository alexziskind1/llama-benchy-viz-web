// SSE client entry point. Connects to /sse, dispatches "view" frames
// into the layout+module renderers, cleans up on "bye".

import { renderView } from "/static/layout.js";

const dashboard = document.getElementById("dashboard");
let firstFrame = true;

function attachStream() {
  const es = new EventSource("/sse");

  es.addEventListener("view", (e) => {
    let vm;
    try {
      vm = JSON.parse(e.data);
    } catch (err) {
      console.error("failed to parse view frame", err);
      return;
    }
    if (firstFrame) {
      dashboard.querySelector(".banner-loading")?.remove();
      firstFrame = false;
    }
    renderView(vm, dashboard);
  });

  es.addEventListener("bye", () => {
    es.close();
    // Add a subtle indicator; keep the last frame on screen.
    if (!document.getElementById("bye-banner")) {
      const b = document.createElement("div");
      b.id = "bye-banner";
      b.textContent = "benchmark finished — connection closed";
      b.style.cssText =
        "position:fixed;bottom:10px;right:12px;background:#1f2129;" +
        "color:#a1a3ad;padding:4px 10px;border:1px solid #2b2d38;" +
        "border-radius:4px;font-size:11px;z-index:10;";
      document.body.appendChild(b);
    }
  });

  es.onerror = () => {
    // EventSource auto-reconnects. If the server is truly gone the
    // "bye" event above will have already been delivered.
  };
}

attachStream();
