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
  language?: string; // Ngôn ngữ: "go", "python", "javascript", "java"...
  returnType?: string; // Return type từ signature
  hasReturnValue?: boolean; // true nếu return value, false nếu void
  isNested?: boolean; // true nếu là nested function
  parentNodeId?: string; // ID của node cha (nếu là nested)
}

export interface Edge {
  source: string;
  target: string;
  type: "calls" | "uses" | "implements";
  hasReturnValue?: boolean; // true = solid line, false = dashed line
  callOrder?: number; // Thứ tự gọi hàm (call forward)
  returnOrder?: number; // Thứ tự return (return backward)
}

export interface GraphData {
  nodes: Node[];
  edges: Edge[];
  fileName: string;
}
