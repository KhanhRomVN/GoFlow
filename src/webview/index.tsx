import React from "react";
import { createRoot } from "react-dom/client";
import Canvas from "./components/Canvas";

declare global {
  interface Window {
    acquireVsCodeApi: () => any;
  }
}

const vscode = window.acquireVsCodeApi();

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<Canvas vscode={vscode} />);
} else {
  console.error("Root element not found");
}
