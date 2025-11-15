import React from "react";
import { createRoot } from "react-dom/client";
import FlowGraph from "./components/FlowGraph";
import { ReactFlowProvider } from "@xyflow/react";

declare global {
  interface Window {
    acquireVsCodeApi: () => any;
  }
}

const vscode = window.acquireVsCodeApi();

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(
    <ReactFlowProvider>
      <FlowGraph vscode={vscode} />
    </ReactFlowProvider>
  );
} else {
  console.error("Root element not found");
}
