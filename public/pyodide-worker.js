/* eslint-disable no-undef */
// Pyodide Web Worker — runs Python code in a background thread
// Loaded from public/ to avoid Next.js bundler issues with Web Workers

importScripts("https://cdn.jsdelivr.net/pyodide/v0.27.6/full/pyodide.js");

let pyodide = null;

async function initPyodide() {
  postMessage({ type: "status", status: "loading" });
  try {
    pyodide = await loadPyodide({
      stdout: (text) => postMessage({ type: "stdout", text }),
      stderr: (text) => postMessage({ type: "stderr", text }),
    });

    // Patch input() to avoid hanging
    pyodide.runPython(`
import builtins
def _no_input(prompt=""):
    print(prompt, end="")
    raise EOFError("input() is not supported in the browser. Test your functions directly instead of running the game loop.")
builtins.input = _no_input
`);

    postMessage({ type: "status", status: "ready" });
  } catch (err) {
    postMessage({ type: "status", status: "error", error: err.message });
  }
}

async function runCode(code, resourceFiles) {
  if (!pyodide) {
    postMessage({ type: "done", error: "Pyodide not initialized" });
    return;
  }

  // Write resource files to virtual FS
  for (const file of resourceFiles || []) {
    try {
      const response = await fetch(file.url);
      const content = await response.text();
      pyodide.FS.writeFile(file.name, content);
    } catch (err) {
      postMessage({ type: "stderr", text: `Failed to load ${file.name}: ${err.message}` });
    }
  }

  try {
    await pyodide.runPythonAsync(code);
    postMessage({ type: "done" });
  } catch (err) {
    // Pyodide wraps Python exceptions — extract the message
    const msg = err.message || String(err);
    postMessage({ type: "stderr", text: msg });
    postMessage({ type: "done", error: msg });
  }
}

onmessage = async (event) => {
  const { type, ...data } = event.data;
  if (type === "init") {
    await initPyodide();
  } else if (type === "run") {
    await runCode(data.code, data.resourceFiles);
  }
};
