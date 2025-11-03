import * as vscode from "vscode";
import { Logger } from "../utils/logger";
import { Edge } from "../models/Node";

interface CallSite {
  functionName: string;
  line: number;
  hasReturnValue: boolean;
  isReturn: boolean;
  definitionLocation?: vscode.Location;
}

export class CallOrderTracker {
  private callOrderCounter = 0;
  private edgeOrderMap = new Map<
    string,
    { callOrder?: number; returnOrder?: number }
  >();
  private readonly MAX_RECURSION_DEPTH = 50;

  /**
   * Analyze execution flow và assign call orders
   */
  async analyzeExecutionFlow(
    rootSymbol: vscode.DocumentSymbol,
    document: vscode.TextDocument,
    allSymbols: vscode.DocumentSymbol[],
    edges: Edge[]
  ): Promise<Map<string, { callOrder?: number; returnOrder?: number }>> {
    Logger.info(
      `[CallOrderTracker] 🚀 START - Root: ${rootSymbol.name} | TotalEdges: ${edges.length}`
    );
    Logger.info(
      `[CallOrderTracker] 📍 Root symbol range: ${rootSymbol.range.start.line}-${rootSymbol.range.end.line}`
    );
    Logger.info(
      `[CallOrderTracker] 📍 Total symbols available: ${allSymbols.length}`
    );

    this.callOrderCounter = 0;
    this.edgeOrderMap.clear();

    const visitedFunctions = new Set<string>();

    await this.traverseFunction(
      rootSymbol,
      document,
      allSymbols,
      edges,
      visitedFunctions,
      0
    );

    Logger.info(
      `[CallOrderTracker] ✅ DONE - Processed ${this.edgeOrderMap.size} edges`
    );
    Logger.info(
      `[CallOrderTracker] 📊 EdgeOrderMap keys: ${Array.from(
        this.edgeOrderMap.keys()
      ).join(", ")}`
    );

    return this.edgeOrderMap;
  }

  /**
   * Kiểm tra xem file có phải là external dependency không
   * (Giống với logic trong GoParser và DeclarationDetector)
   */
  private isExternalDependency(filePath: string): boolean {
    return (
      filePath.includes("/usr/local/go/") ||
      filePath.includes("/go/pkg/mod/") ||
      filePath.includes("\\go\\pkg\\mod\\") ||
      filePath.includes("/vendor/") ||
      !filePath.endsWith(".go")
    );
  }

  /**
   * Traverse một function và track call order
   */
  private async traverseFunction(
    symbol: vscode.DocumentSymbol,
    document: vscode.TextDocument,
    allSymbols: vscode.DocumentSymbol[],
    edges: Edge[],
    visitedFunctions: Set<string>,
    depth: number = 0 // ✅ THÊM THAM SỐ DEPTH
  ): Promise<void> {
    const functionId = this.createNodeId(symbol);

    // ✅ CHECK DEPTH LIMIT TRƯỚC
    if (depth > this.MAX_RECURSION_DEPTH) {
      Logger.warn(
        `[CallOrderTracker] ⚠️ Max recursion depth reached at: ${functionId} (depth=${depth})`
      );
      return;
    }

    Logger.info(
      `[CallOrderTracker] 🔍 Traversing function: ${functionId} (depth=${depth})`
    );

    // Prevent infinite recursion
    if (visitedFunctions.has(functionId)) {
      Logger.warn(
        `[CallOrderTracker] ⚠️ Already visited: ${functionId} - skipping`
      );
      return;
    }

    visitedFunctions.add(functionId);

    const text = document.getText(symbol.range);
    const lines = text.split("\n");

    Logger.info(`[CallOrderTracker] 📝 Function code (${lines.length} lines):`);
    lines.forEach((line, idx) => {
      if (idx > 0 && idx < 10) {
        Logger.info(`  Line ${idx}: ${line.trim()}`);
      }
    });

    // Extract call sites in order
    const callSites = await this.extractCallSites(
      symbol,
      document,
      allSymbols,
      lines
    );

    Logger.info(
      `[CallOrderTracker] 📞 Found ${callSites.length} call sites in ${functionId}`
    );

    // Process each call site in order
    for (const callSite of callSites) {
      this.callOrderCounter++;

      // ✅ TÌM TARGET SYMBOL ACROSS FILES - CHỈ TRONG PROJECT
      let targetSymbol: vscode.DocumentSymbol | undefined;
      let targetDocument: vscode.TextDocument = document;

      // Thử tìm trong current document trước
      targetSymbol = allSymbols.find(
        (s) => this.extractCleanFunctionName(s.name) === callSite.functionName
      );

      // Nếu không tìm thấy, resolve definition để tìm cross-file (CHỈ TRONG PROJECT)
      if (!targetSymbol && callSite.definitionLocation) {
        const defFilePath = callSite.definitionLocation.uri.fsPath;

        // ✅ ÁP DỤNG BỘ LỌC: Chỉ xử lý project files
        if (this.isExternalDependency(defFilePath)) {
          Logger.info(
            `[traverseFunction] ⚠️ Skipping external dependency: ${callSite.functionName} in ${defFilePath}`
          );
          continue;
        }

        try {
          targetDocument = await vscode.workspace.openTextDocument(
            callSite.definitionLocation.uri
          );
          const targetSymbols = await vscode.commands.executeCommand<
            vscode.DocumentSymbol[]
          >(
            "vscode.executeDocumentSymbolProvider",
            callSite.definitionLocation.uri
          );

          if (targetSymbols) {
            targetSymbol = this.findSymbolAtPosition(
              targetSymbols,
              callSite.definitionLocation.range.start
            );
          }
        } catch (error) {
          Logger.error(
            `[CallOrderTracker] Failed to load cross-file symbol: ${callSite.functionName}`,
            error
          );
        }
      }

      // Nếu không tìm thấy, resolve definition để tìm cross-file
      if (!targetSymbol && callSite.definitionLocation) {
        try {
          targetDocument = await vscode.workspace.openTextDocument(
            callSite.definitionLocation.uri
          );
          const targetSymbols = await vscode.commands.executeCommand<
            vscode.DocumentSymbol[]
          >(
            "vscode.executeDocumentSymbolProvider",
            callSite.definitionLocation.uri
          );

          if (targetSymbols) {
            targetSymbol = this.findSymbolAtPosition(
              targetSymbols,
              callSite.definitionLocation.range.start
            );
          }
        } catch (error) {
          Logger.error(
            `[CallOrderTracker] Failed to load cross-file symbol: ${callSite.functionName}`,
            error
          );
        }
      }

      if (!targetSymbol) {
        Logger.warn(
          `[CallOrderTracker] ⚠️ Target symbol not found for: ${callSite.functionName}`
        );
        continue;
      }

      const targetId = this.createNodeId(targetSymbol);
      const edgeKey = `${functionId}->${targetId}`;

      // Assign call order
      if (!this.edgeOrderMap.has(edgeKey)) {
        this.edgeOrderMap.set(edgeKey, {});
      }

      const edgeOrder = this.edgeOrderMap.get(edgeKey)!;
      edgeOrder.callOrder = this.callOrderCounter;

      Logger.info(
        `[CallOrderTracker] ✅ Assigned callOrder=${this.callOrderCounter} to edge: ${edgeKey}`
      );

      // ✅ RECURSIVE TRAVERSE - TRUYỀN DEPTH + 1
      const targetSymbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", targetDocument.uri);

      if (targetSymbols) {
        await this.traverseFunction(
          targetSymbol,
          targetDocument,
          targetSymbols,
          edges,
          visitedFunctions,
          depth + 1 // ✅ TĂNG DEPTH
        );
      }

      // If function has return value, track return order
      if (callSite.hasReturnValue) {
        this.callOrderCounter++;
        edgeOrder.returnOrder = this.callOrderCounter;

        Logger.info(
          `[CallOrderTracker] ✅ Assigned returnOrder=${this.callOrderCounter} to edge: ${edgeKey}`
        );
      }
    }
  }

  /**
   * Extract call sites from function body in order
   */
  private async extractCallSites(
    symbol: vscode.DocumentSymbol,
    document: vscode.TextDocument,
    allSymbols: vscode.DocumentSymbol[],
    lines: string[]
  ): Promise<CallSite[]> {
    const callSites: CallSite[] = [];
    const functionCallRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

    Logger.info(
      `[extractCallSites] 🔍 Analyzing ${lines.length} lines in function: ${symbol.name}`
    );

    for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      let match;

      Logger.info(`[extractCallSites] Line ${lineIndex}: "${line.trim()}"`);

      while ((match = functionCallRegex.exec(line)) !== null) {
        const functionName = match[1];
        const charIndex = match.index;
        const absoluteLine = symbol.range.start.line + lineIndex;
        const position = new vscode.Position(absoluteLine, charIndex);

        Logger.info(
          `[extractCallSites] 📞 Detected call: ${functionName}() at line ${absoluteLine}, char ${charIndex}`
        );

        try {
          const definitions = await vscode.commands.executeCommand<
            vscode.Location[]
          >("vscode.executeDefinitionProvider", document.uri, position);

          if (definitions && definitions.length > 0) {
            const def = definitions[0];
            const filePath = def.uri.fsPath;

            // ✅ THÊM BỘ LỌC: Bỏ qua stdlib và vendor (giống GoParser)
            if (
              filePath.includes("/usr/local/go/") ||
              filePath.includes("/go/pkg/mod/") ||
              filePath.includes("\\go\\pkg\\mod\\") ||
              filePath.includes("/vendor/") ||
              !filePath.endsWith(".go")
            ) {
              Logger.info(
                `[extractCallSites] ⚠️ Skipping external dependency: ${functionName} in ${filePath}`
              );
              continue;
            }

            Logger.info(
              `[extractCallSites] ✅ Definition found: ${filePath}:${def.range.start.line}`
            );

            // ✅ HỖ TRỢ CROSS-FILE: Loại bỏ check def.uri.fsPath === document.fileName
            const targetDocument = await vscode.workspace.openTextDocument(
              def.uri
            );
            const targetSymbols = await vscode.commands.executeCommand<
              vscode.DocumentSymbol[]
            >("vscode.executeDocumentSymbolProvider", def.uri);

            if (targetSymbols) {
              const targetSymbol = this.findSymbolAtPosition(
                targetSymbols,
                def.range.start
              );

              if (targetSymbol && this.isFunctionOrMethod(targetSymbol)) {
                const cleanName = this.extractCleanFunctionName(
                  targetSymbol.name
                );
                const hasReturnValue = this.detectReturnValueUsage(
                  line,
                  charIndex,
                  functionName
                );
                const isReturn = /^\s*return\s+/.test(line.trim());

                Logger.info(
                  `[extractCallSites] ✅ Valid call site: ${cleanName} | hasReturnValue=${hasReturnValue} | isReturn=${isReturn} | file=${def.uri.fsPath}`
                );

                callSites.push({
                  functionName: cleanName,
                  line: absoluteLine,
                  hasReturnValue,
                  isReturn,
                  definitionLocation: def,
                });
              } else {
                Logger.warn(
                  `[extractCallSites] ⚠️ Target symbol is not a function/method: ${
                    targetSymbol?.name || "undefined"
                  }`
                );
              }
            } else {
              Logger.warn(
                `[extractCallSites] ⚠️ Definition in different file: ${def.uri.fsPath}`
              );
            }
          } else {
            Logger.warn(
              `[extractCallSites] ⚠️ No definitions found for: ${functionName}`
            );
          }
        } catch (error) {
          Logger.error(
            `[extractCallSites] ❌ Failed to resolve: ${functionName}`,
            error
          );
        }
      }
    }

    Logger.info(
      `[extractCallSites] ✅ DONE - Found ${callSites.length} call sites`
    );

    return callSites;
  }

  /**
   * Detect if return value is used
   */
  private detectReturnValueUsage(
    line: string,
    callPosition: number,
    functionName: string
  ): boolean {
    const beforeCall = line.substring(0, callPosition).trim();
    const lineUpToCall = line.substring(0, callPosition + functionName.length);

    // Assignment patterns
    if (/:=/.test(lineUpToCall) || /[^=!<>]=(?!=)/.test(lineUpToCall)) {
      return true;
    }

    // Return statement
    if (/\breturn\s+$/.test(beforeCall)) return true;

    // Comparison
    if (/[!=<>]+\s*$/.test(beforeCall)) return true;

    // Function argument
    if (/[,(]\s*$/.test(beforeCall)) return true;

    // Control flow
    if (/\b(if|for|switch)\s*\(\s*$/.test(beforeCall)) return true;

    // Standalone call
    if (/\b(defer|go)\s+$/.test(beforeCall)) return false;

    const standalonePattern = /^(\s*)(\w+\.)*\w+\s*$/;
    const checkStr = line
      .substring(0, callPosition + functionName.length)
      .trim();

    if (standalonePattern.test(checkStr)) return false;

    return beforeCall.length > 0 && !/^\s*$/.test(beforeCall);
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
    const cleanName = this.extractCleanFunctionName(symbol.name);
    return `${type}_${cleanName}`;
  }

  private extractCleanFunctionName(fullName: string): string {
    const methodPattern = /\(.*?\)\s+(\w+)/;
    const match = fullName.match(methodPattern);
    return match ? match[1] : fullName;
  }
}
