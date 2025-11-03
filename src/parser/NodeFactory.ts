import * as vscode from "vscode";
import { Node } from "../models/Node";

export class NodeFactory {
  createNodeFromSymbol(
    symbol: vscode.DocumentSymbol,
    document: vscode.TextDocument,
    parentSymbol?: vscode.DocumentSymbol
  ): Node {
    const nodeType = this.getNodeType(symbol.kind);
    const cleanName = this.extractCleanFunctionName(symbol.name);
    const id = `${nodeType}_${cleanName}`;
    const code = document.getText(symbol.range);
    const language = this.detectLanguage(document.fileName);
    const { returnType, hasReturnValue } = this.analyzeReturnType(
      code,
      language
    );
    const isNested = !!parentSymbol;
    const parentNodeId = parentSymbol
      ? `${this.getNodeType(parentSymbol.kind)}_${this.extractCleanFunctionName(
          parentSymbol.name
        )}`
      : undefined;

    return {
      id,
      label: cleanName,
      type: nodeType,
      file: document.fileName,
      line: symbol.range.start.line + 1,
      endLine: symbol.range.end.line + 1,
      kind: symbol.kind,
      code,
      language,
      returnType,
      hasReturnValue,
      isNested,
      parentNodeId,
    };
  }

  private getNodeType(
    kind: vscode.SymbolKind
  ):
    | "function"
    | "method"
    | "class"
    | "struct"
    | "interface"
    | "enum"
    | "type"
    | "unknown" {
    const typeMap: Record<number, any> = {
      [vscode.SymbolKind.Function]: "function",
      [vscode.SymbolKind.Method]: "method",
      [vscode.SymbolKind.Class]: "class",
      [vscode.SymbolKind.Struct]: "struct",
      [vscode.SymbolKind.Interface]: "interface",
      [vscode.SymbolKind.Enum]: "enum",
      [vscode.SymbolKind.TypeParameter]: "type",
    };
    return typeMap[kind] || "unknown";
  }

  private extractCleanFunctionName(fullName: string): string {
    const methodPattern = /\(.*?\)\s+(\w+)/;
    const match = fullName.match(methodPattern);
    return match ? match[1] : fullName;
  }

  private detectLanguage(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const langMap: Record<string, string> = {
      go: "go",
      py: "python",
      js: "javascript",
      ts: "typescript",
      java: "java",
      cs: "csharp",
      rb: "ruby",
      php: "php",
      rs: "rust",
      kt: "kotlin",
      swift: "swift",
      cpp: "cpp",
      c: "c",
    };
    return langMap[ext] || "unknown";
  }

  private analyzeReturnType(
    code: string,
    language: string
  ): { returnType: string; hasReturnValue: boolean } {
    const firstLine = code.split("\n")[0].trim();

    // Go
    if (language === "go") {
      const goReturnMatch = firstLine.match(/\)\s*([^{]+)\s*{/);
      if (goReturnMatch) {
        const returnPart = goReturnMatch[1].trim();
        return {
          returnType: returnPart,
          hasReturnValue: returnPart !== "" && returnPart !== "void",
        };
      }
    }

    // Python
    if (language === "python") {
      const pyReturnMatch = firstLine.match(/->\s*([^:]+):/);
      if (pyReturnMatch) {
        const returnPart = pyReturnMatch[1].trim();
        return {
          returnType: returnPart,
          hasReturnValue: returnPart !== "None",
        };
      }
      return {
        returnType: "unknown",
        hasReturnValue: /\breturn\s+[^;\n]+/.test(code),
      };
    }

    // JavaScript/TypeScript
    if (language === "javascript" || language === "typescript") {
      const jsReturnMatch = firstLine.match(/\):\s*([^{]+)\s*{/);
      if (jsReturnMatch) {
        const returnPart = jsReturnMatch[1].trim();
        return {
          returnType: returnPart,
          hasReturnValue: returnPart !== "void",
        };
      }
      return {
        returnType: "unknown",
        hasReturnValue: /\breturn\s+[^;\n]+/.test(code),
      };
    }

    // Java/C#/Kotlin
    if (["java", "csharp", "kotlin"].includes(language)) {
      const javaReturnMatch = firstLine.match(
        /^\s*(?:public|private|protected|internal|static|final|override)?\s+([^\s(]+)\s+\w+\s*\(/
      );
      if (javaReturnMatch) {
        const returnPart = javaReturnMatch[1].trim();
        return {
          returnType: returnPart,
          hasReturnValue: returnPart !== "void" && returnPart !== "Unit",
        };
      }
    }

    return {
      returnType: "unknown",
      hasReturnValue: /\breturn\s+[^;\n]+/.test(code),
    };
  }
}
