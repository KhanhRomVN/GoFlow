import * as vscode from "vscode";
import { Logger } from "../utils/logger";

export interface EdgeDetectionResult {
  target: string;
  usesReturnValue: boolean;
}

export interface EdgeDetectionContext {
  document: vscode.TextDocument;
  symbol: vscode.DocumentSymbol;
  nodeMap: Map<string, any>;
}

export class EdgeDetector {
  /**
   * Detect if return value is used in a function call
   */
  detectReturnValueUsage(
    line: string,
    callPosition: number,
    functionName: string
  ): boolean {
    const beforeCall = line.substring(0, callPosition).trim();
    const lineUpToCall = line.substring(0, callPosition + functionName.length);

    // PRIORITY 1: Assignment patterns
    if (/:=/.test(lineUpToCall) || /[^=!<>]=(?!=)/.test(lineUpToCall)) {
      return true;
    }

    // PRIORITY 2: Immediate context
    if (/\breturn\s+$/.test(beforeCall)) return true;
    if (/[!=<>]+\s*$/.test(beforeCall)) return true;
    if (/[,(]\s*$/.test(beforeCall)) return true;
    if (/\b(if|for|switch)\s*\(\s*$/.test(beforeCall)) return true;

    // PRIORITY 3: Standalone call
    if (/\b(defer|go)\s+$/.test(beforeCall)) return false;

    const standalonePattern = /^(\s*)(\w+\.)*\w+\s*$/;
    const checkStr = line
      .substring(0, callPosition + functionName.length)
      .trim();

    if (standalonePattern.test(checkStr)) return false;
    if (/{\s*$/.test(beforeCall)) return false;

    // Logging methods check
    const loggingMethods = [
      "Error",
      "Info",
      "Debug",
      "Warn",
      "Log",
      "Print",
      "Printf",
      "Println",
    ];
    if (loggingMethods.includes(functionName)) {
      const loggingPattern = /^(\s*)(\w+\.)*\w+\s*$/;
      if (loggingPattern.test(checkStr)) return false;
    }

    return beforeCall.length > 0 && !/^\s*$/.test(beforeCall);
  }

  /**
   * Find function calls with return value usage detection
   */
  async findFunctionCallsWithReturnUsage(
    context: EdgeDetectionContext
  ): Promise<EdgeDetectionResult[]> {
    const { document, symbol, nodeMap } = context;
    const callees: EdgeDetectionResult[] = [];
    const text = document.getText(symbol.range);
    const lines = text.split("\n");
    const functionCallRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

    for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      let match;

      while ((match = functionCallRegex.exec(line)) !== null) {
        const functionName = match[1];
        const charIndex = match.index;
        const absoluteLine = symbol.range.start.line + lineIndex;
        const position = new vscode.Position(absoluteLine, charIndex);

        try {
          const definitions = await vscode.commands.executeCommand<
            vscode.Location[]
          >("vscode.executeDefinitionProvider", document.uri, position);

          if (definitions && definitions.length > 0) {
            const def = definitions[0];

            if (def.uri.fsPath === document.fileName) {
              const defSymbols = await vscode.commands.executeCommand<
                vscode.DocumentSymbol[]
              >("vscode.executeDocumentSymbolProvider", def.uri);

              if (defSymbols) {
                const targetSymbol = this.findSymbolAtPosition(
                  defSymbols,
                  def.range.start
                );

                if (targetSymbol && this.isFunctionOrMethod(targetSymbol)) {
                  const targetId = this.createNodeId(targetSymbol);
                  const sourceId = this.createNodeId(symbol);

                  if (targetId !== sourceId) {
                    const usesReturnValue = this.detectReturnValueUsage(
                      line,
                      charIndex,
                      functionName
                    );

                    callees.push({ target: targetId, usesReturnValue });
                  }
                }
              }
            }
          }
        } catch (error) {
          Logger.error(`Could not resolve definition for: ${functionName}`);
        }
      }
    }

    return callees;
  }

  private findSymbolAtPosition(
    symbols: vscode.DocumentSymbol[],
    position: vscode.Position
  ): vscode.DocumentSymbol | undefined {
    for (const symbol of symbols) {
      if (symbol.range.contains(position)) {
        if (symbol.children && symbol.children.length > 0) {
          const childSymbol = this.findSymbolAtPosition(
            symbol.children,
            position
          );
          if (childSymbol) return childSymbol;
        }
        return symbol;
      }
    }
    return undefined;
  }

  private isFunctionOrMethod(symbol: vscode.DocumentSymbol): boolean {
    return (
      symbol.kind === vscode.SymbolKind.Function ||
      symbol.kind === vscode.SymbolKind.Method
    );
  }

  private createNodeId(symbol: vscode.DocumentSymbol): string {
    const type =
      symbol.kind === vscode.SymbolKind.Function ? "function" : "method";
    return `${type}_${symbol.name}`;
  }
}
