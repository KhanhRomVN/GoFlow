import * as vscode from "vscode";
import { Logger } from "../utils/logger";

export interface EdgeDetectionResult {
  target: string;
  usesReturnValue: boolean;
  callOrder: number;
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
    Logger.info(`[EdgeDetector] 🚀 START findFunctionCallsWithReturnUsage`, {
      symbolName: context.symbol?.name || "UNKNOWN",
      documentUri: context.document?.uri?.fsPath || "UNKNOWN",
    });

    try {
      const { document, symbol, nodeMap } = context;

      if (!document) {
        Logger.error(`[EdgeDetector] ❌ CRITICAL: document is null/undefined`);
        return [];
      }

      if (!symbol) {
        Logger.error(`[EdgeDetector] ❌ CRITICAL: symbol is null/undefined`);
        return [];
      }

      Logger.debug(`[EdgeDetector] Context validation passed`, {
        documentUri: document.uri.fsPath,
        symbolName: symbol.name,
        symbolKind: symbol.kind,
        nodeMapSize: nodeMap.size,
      });

      const callees: EdgeDetectionResult[] = [];

      let text: string;
      try {
        text = document.getText(symbol.range);
        Logger.debug(`[EdgeDetector] Got symbol text`, {
          textLength: text.length,
          rangeStart: symbol.range.start.line,
          rangeEnd: symbol.range.end.line,
        });
      } catch (error) {
        Logger.error(`[EdgeDetector] ❌ Failed to get symbol text`, error);
        return [];
      }

      const lines = text.split("\n");
      const functionCallRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

      let callOrder = 0;

      Logger.info(`[EdgeDetector] 📊 Analyzing function: ${symbol.name}`, {
        totalLines: lines.length,
        functionRange: `${symbol.range.start.line}-${symbol.range.end.line}`,
        fileName: document.fileName,
      });

      // CRITICAL: Start from lineIndex = 1 to skip function signature
      for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        let match;

        // Reset regex index for each line
        functionCallRegex.lastIndex = 0;

        while ((match = functionCallRegex.exec(line)) !== null) {
          const functionName = match[1];
          const charIndex = match.index;
          const absoluteLine = symbol.range.start.line + lineIndex;
          const position = new vscode.Position(absoluteLine, charIndex);

          Logger.debug(
            `[EdgeDetector] 🔍 Found function call: ${functionName}`,
            {
              relativeLineIndex: lineIndex,
              absoluteLine: absoluteLine + 1,
              charIndex,
              lineContent: line.trim().substring(0, 80),
            }
          );

          try {
            Logger.debug(
              `[EdgeDetector] Resolving definition for: ${functionName}`
            );

            const definitions = await vscode.commands.executeCommand<
              vscode.Location[]
            >("vscode.executeDefinitionProvider", document.uri, position);

            Logger.debug(`[EdgeDetector] Definition resolution result`, {
              functionName,
              definitionsFound: definitions?.length || 0,
            });

            if (definitions && definitions.length > 0) {
              const def = definitions[0];

              Logger.debug(
                `[EdgeDetector] ✓ Resolved definition for: ${functionName}`,
                {
                  targetFile: def.uri.fsPath,
                  targetLine: def.range.start.line + 1,
                  isSameFile: def.uri.fsPath === document.fileName,
                }
              );

              // CRITICAL CHECK: Same file only
              if (def.uri.fsPath !== document.fileName) {
                Logger.debug(
                  `[EdgeDetector] ⚠️ Cross-file call skipped: ${functionName}`,
                  {
                    sourceFile: document.fileName,
                    targetFile: def.uri.fsPath,
                  }
                );
                continue;
              }

              Logger.debug(
                `[EdgeDetector] Getting document symbols for same-file call`
              );

              const defSymbols = await vscode.commands.executeCommand<
                vscode.DocumentSymbol[]
              >("vscode.executeDocumentSymbolProvider", def.uri);

              if (!defSymbols) {
                Logger.warn(
                  `[EdgeDetector] ⚠️ No symbols returned for: ${functionName}`
                );
                continue;
              }

              Logger.debug(
                `[EdgeDetector] Got ${defSymbols.length} symbols, finding target`
              );

              const targetSymbol = this.findSymbolAtPosition(
                defSymbols,
                def.range.start
              );

              if (!targetSymbol) {
                Logger.warn(
                  `[EdgeDetector] ⚠️ No symbol at position for: ${functionName}`,
                  {
                    position: `${def.range.start.line}:${def.range.start.character}`,
                  }
                );
                continue;
              }

              Logger.debug(`[EdgeDetector] Found target symbol`, {
                targetSymbolName: targetSymbol.name,
                targetSymbolKind: targetSymbol.kind,
                isFunction: this.isFunctionOrMethod(targetSymbol),
              });

              if (!this.isFunctionOrMethod(targetSymbol)) {
                Logger.debug(
                  `[EdgeDetector] ⚠️ Not a function/method: ${functionName}`,
                  {
                    symbolKind: targetSymbol.kind,
                    expectedKinds: [
                      vscode.SymbolKind.Function,
                      vscode.SymbolKind.Method,
                    ],
                  }
                );
                continue;
              }

              const targetId = this.createNodeId(targetSymbol);
              const sourceId = this.createNodeId(symbol);

              Logger.debug(`[EdgeDetector] Created node IDs`, {
                sourceId,
                targetId,
                isSelfCall: targetId === sourceId,
              });

              if (targetId === sourceId) {
                Logger.debug(
                  `[EdgeDetector] ⚠️ Skipped self-call: ${functionName}`,
                  {
                    nodeId: sourceId,
                  }
                );
                continue;
              }

              // CRITICAL: Detect return value usage
              const usesReturnValue = this.detectReturnValueUsage(
                line,
                charIndex,
                functionName
              );

              // INCREMENT callOrder
              callOrder++;

              Logger.info(`[EdgeDetector] ✅ Created edge #${callOrder}`, {
                source: sourceId,
                target: targetId,
                functionCall: functionName,
                usesReturnValue,
                lineNumber: absoluteLine + 1,
                lineContent: line.trim().substring(0, 60),
              });

              callees.push({
                target: targetId,
                usesReturnValue,
                callOrder,
              });
            } else {
              Logger.debug(
                `[EdgeDetector] ⚠️ No definition found for: ${functionName}`,
                {
                  position: `${absoluteLine + 1}:${charIndex}`,
                }
              );
            }
          } catch (error) {
            Logger.error(`[EdgeDetector] ❌ Error resolving: ${functionName}`, {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              line: absoluteLine + 1,
            });
          }
        }
      }

      Logger.info(`[EdgeDetector] ✅ Completed analysis for: ${symbol.name}`, {
        totalEdgesCreated: callees.length,
        edges: callees.map((c) => `${c.target} (order=${c.callOrder})`),
      });

      return callees;
    } catch (outerError) {
      Logger.error(
        `[EdgeDetector] ❌❌❌ CRITICAL ERROR in findFunctionCallsWithReturnUsage`,
        {
          error:
            outerError instanceof Error
              ? outerError.message
              : String(outerError),
          stack: outerError instanceof Error ? outerError.stack : undefined,
        }
      );
      return [];
    }
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
