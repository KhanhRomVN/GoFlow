import React from "react";
import { createRoot } from "react-dom/client";
import FlowCanvas from "./components/FlowCanvas";

declare global {
  interface Window {
    acquireVsCodeApi: () => any;
  }
}

const vscode = window.acquireVsCodeApi();

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<FlowCanvas vscode={vscode} />);
} else {
  console.error("Root element not found");
}
