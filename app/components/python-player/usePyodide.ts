"use client";

import { useEffect, useRef, useReducer, useCallback } from "react";

export type PyodideStatus = "idle" | "loading" | "ready" | "running" | "error";

export interface OutputLine {
  stream: "stdout" | "stderr";
  text: string;
}

interface State {
  status: PyodideStatus;
  output: OutputLine[];
}

type Action =
  | { type: "set_status"; status: PyodideStatus }
  | { type: "add_output"; line: OutputLine }
  | { type: "clear_output" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set_status":
      return { ...state, status: action.status };
    case "add_output":
      return { ...state, output: [...state.output, action.line] };
    case "clear_output":
      return { ...state, output: [] };
  }
}

export function usePyodide() {
  const workerRef = useRef<Worker | null>(null);
  const [state, dispatch] = useReducer(reducer, {
    status: "idle",
    output: [],
  });

  useEffect(() => {
    const worker = new Worker("/pyodide-worker.js");
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const msg = event.data;
      switch (msg.type) {
        case "status":
          dispatch({
            type: "set_status",
            status: msg.status as PyodideStatus,
          });
          break;
        case "stdout":
          dispatch({
            type: "add_output",
            line: { stream: "stdout", text: msg.text },
          });
          break;
        case "stderr":
          dispatch({
            type: "add_output",
            line: { stream: "stderr", text: msg.text },
          });
          break;
        case "done":
          dispatch({ type: "set_status", status: "ready" });
          break;
      }
    };

    // Start loading Pyodide immediately
    worker.postMessage({ type: "init" });
    dispatch({ type: "set_status", status: "loading" });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const runCode = useCallback(
    (code: string, resourceFiles?: { name: string; url: string }[]) => {
      if (!workerRef.current || state.status === "loading") return;
      dispatch({ type: "clear_output" });
      dispatch({ type: "set_status", status: "running" });
      workerRef.current.postMessage({
        type: "run",
        code,
        resourceFiles: resourceFiles || [],
      });
    },
    [state.status]
  );

  const clearOutput = useCallback(() => {
    dispatch({ type: "clear_output" });
  }, []);

  return {
    status: state.status,
    output: state.output,
    runCode,
    clearOutput,
  };
}
