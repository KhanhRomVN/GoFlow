import * as vscode from "vscode";

export interface Node {
  id: string;
  label: string;
  type: "function" | "method" | "struct" | "interface" | "unknown";
  file: string;
  line: number;
  kind: vscode.SymbolKind;
}

export interface Edge {
  source: string;
  target: string;
  type: "calls" | "uses" | "implements";
}

export interface GraphData {
  nodes: Node[];
  edges: Edge[];
  fileName: string;
}
