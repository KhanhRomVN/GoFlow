import * as vscode from "vscode";

export interface Node {
  id: string;
  label: string;
  type:
    | "function"
    | "method"
    | "class"
    | "struct"
    | "interface"
    | "enum"
    | "type"
    | "unknown";
  file: string;
  line: number;
  endLine?: number;
  kind: vscode.SymbolKind;
  code?: string;
  language?: string;
  returnType?: string;
  hasReturnValue?: boolean;
  isNested?: boolean;
  parentNodeId?: string;
}

export interface Edge {
  source: string;
  target: string;
  type: "calls" | "uses" | "implements";
  hasReturnValue?: boolean;
  callOrder?: number;
  returnOrder?: number;
}

export interface GraphData {
  nodes: Node[];
  edges: Edge[];
  fileName: string;
}
