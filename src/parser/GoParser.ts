import * as vscode from "vscode";
import { GraphData, Node, Edge } from "../models/Node";
import { Logger } from "../utils/logger";

export class GoParser {
  async parseFile(document: vscode.TextDocument): Promise<GraphData> {
    try {
      const symbols = await this.getDocumentSymbols(document);
      const nodes: Node[] = [];
      const edges: Edge[] = [];
      const edgeMap = new Map<string, Set<string>>();

      // === PASS 1: Tạo TẤT CẢ nodes (FunctionNode + DeclarationNode) ===
      const functionNodes: Node[] = [];
      const declarationSymbols: vscode.DocumentSymbol[] = [];

      for (const symbol of symbols) {
        // Tạo FunctionNode
        if (this.isFunctionOrMethod(symbol)) {
          const parentSymbol = this.findParentSymbol(symbols, symbol);
          if (parentSymbol && this.isFunctionOrMethod(parentSymbol)) {
            continue; // Bỏ qua nested functions
          }

          const node = this.createNodeFromSymbol(symbol, document);
          functionNodes.push(node);
          nodes.push(node);
        }
        // Thu thập DeclarationSymbols
        else if (this.isDeclaration(symbol)) {
          declarationSymbols.push(symbol);
        }
      }

      // Tạo node map để lookup nhanh
      const nodeMap = new Map<string, Node>();
      nodes.forEach((node) => nodeMap.set(node.id, node));

      // === PASS 2: Tạo edges + track declaration usage ===
      const declarationUsageMap = new Map<string, Set<string>>(); // declarationId -> Set<functionId>

      for (const functionNode of functionNodes) {
        const symbol = symbols.find((s) => {
          const nodeType = this.getNodeType(s.kind);
          const cleanName = this.extractCleanFunctionName(s.name);
          const id = `${nodeType}_${cleanName}`;
          return id === functionNode.id && this.isFunctionOrMethod(s);
        });

        if (!symbol) continue;

        // Tìm function calls
        const callees = await this.findFunctionCallsWithReturnUsage(
          document,
          symbol,
          nodeMap
        );

        for (const callee of callees) {
          const edgeKey = `${functionNode.id}->${callee.target}`;
          if (!edgeMap.has(functionNode.id)) {
            edgeMap.set(functionNode.id, new Set());
          }

          if (!edgeMap.get(functionNode.id)!.has(callee.target)) {
            edges.push({
              source: functionNode.id,
              target: callee.target,
              type: "calls",
              hasReturnValue: callee.usesReturnValue,
            });
            edgeMap.get(functionNode.id)!.add(callee.target);
          }
        }

        // Tìm declaration usages
        const declarations = await this.findDeclarationUsages(
          document,
          symbol,
          declarationSymbols
        );

        for (const { declarationSymbol } of declarations) {
          const declType = this.getNodeType(declarationSymbol.kind);
          const declId = `${declType}_${declarationSymbol.name}`;

          if (!declarationUsageMap.has(declId)) {
            declarationUsageMap.set(declId, new Set());
          }
          declarationUsageMap.get(declId)!.add(functionNode.id);
        }
      }

      // === PASS 3: Tạo DeclarationNodes dựa trên usage ===
      let declarationIndex = 0;
      declarationUsageMap.forEach((usedByFunctions, baseDeclarationId) => {
        const declarationSymbol = declarationSymbols.find((s) => {
          const type = this.getNodeType(s.kind);
          const id = `${type}_${s.name}`;
          return id === baseDeclarationId;
        });

        if (!declarationSymbol) return;

        usedByFunctions.forEach((functionId) => {
          const uniqueDeclarationId = `${baseDeclarationId}_usage_${declarationIndex++}`;

          const declarationNode = this.createNodeFromSymbol(
            declarationSymbol,
            document
          );

          declarationNode.id = uniqueDeclarationId;
          (declarationNode as any).usedBy = [functionId];
          (declarationNode as any).baseDeclarationId = baseDeclarationId;

          nodes.push(declarationNode);
          nodeMap.set(uniqueDeclarationId, declarationNode);

          edges.push({
            source: functionId,
            target: uniqueDeclarationId,
            type: "uses",
          });
        });
      });

      // Validate edges
      const validNodeIds = new Set(nodes.map((n) => n.id));
      const validEdges = edges.filter((edge) => {
        const isValid =
          validNodeIds.has(edge.source) && validNodeIds.has(edge.target);
        if (!isValid) {
          Logger.error(
            `Removed invalid edge: ${edge.source} -> ${edge.target}`
          );
        }
        return isValid;
      });

      return {
        nodes,
        edges: validEdges,
        fileName: document.fileName,
      };
    } catch (error) {
      Logger.error("Failed to parse Go file", error);
      throw error;
    }
  }

  private detectReturnValueUsage(
    line: string,
    callPosition: number,
    functionName: string
  ): boolean {
    const beforeCall = line.substring(0, callPosition).trim();
    const lineUpToCall = line.substring(0, callPosition + functionName.length);

    // ═══════════════════════════════════════════════════════════
    // PRIORITY 1: Check TOÀN BỘ LINE cho assignment patterns
    // ═══════════════════════════════════════════════════════════

    // Pattern 1a: Short variable declaration (:=) trong toàn bộ line up to call
    if (/:=/.test(lineUpToCall)) {
      return true;
    }

    // Pattern 1b: Regular assignment (=) trong toàn bộ line up to call
    if (/[^=!<>]=(?!=)/.test(lineUpToCall)) {
      return true;
    }

    // ═══════════════════════════════════════════════════════════
    // PRIORITY 2: Check beforeCall cho immediate context
    // ═══════════════════════════════════════════════════════════

    // Pattern 2: Return statement
    if (/\breturn\s+$/.test(beforeCall)) {
      return true;
    }

    // Pattern 3: Comparison operators
    if (/[!=<>]+\s*$/.test(beforeCall)) {
      return true;
    }

    // Pattern 4: Function argument hoặc nested call
    if (/[,(]\s*$/.test(beforeCall)) {
      return true;
    }

    // Pattern 5: If/for/switch condition
    if (/\b(if|for|switch)\s*\(\s*$/.test(beforeCall)) {
      return true;
    }

    // ═══════════════════════════════════════════════════════════
    // PRIORITY 3: Detect STANDALONE CALL (không dùng return value)
    // ═══════════════════════════════════════════════════════════

    // Pattern 6: Defer, go statements (không dùng return value)
    if (/\b(defer|go)\s+$/.test(beforeCall)) {
      return false;
    }

    // Pattern 7: Standalone call - CHỈ có tên function/method, không có context
    // Đặc biệt quan trọng: logger.Error() calls thường là standalone
    const standalonePattern = /^(\s*)(\w+\.)*\w+\s*$/;
    const checkStr = line
      .substring(0, callPosition + functionName.length)
      .trim();

    // THÊM: Kiểm tra xem có phải là method call không dùng return value
    if (standalonePattern.test(checkStr)) {
      return false;
    }

    // Pattern 8: Inside block start (statement sau dấu {)
    if (/{\s*$/.test(beforeCall)) {
      return false;
    }

    // ═══════════════════════════════════════════════════════════
    // ĐẶC BIỆT: Xử lý logger.Error() và các logging calls
    // ═══════════════════════════════════════════════════════════

    // Nếu là logging method (Error, Info, Debug, Warn, v.v.) và không có assignment
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
      // Kiểm tra xem có phải là standalone logging call không
      const loggingPattern = /^(\s*)(\w+\.)*\w+\s*$/;
      if (loggingPattern.test(checkStr)) {
        return false;
      }
    }

    // ═══════════════════════════════════════════════════════════
    // DEFAULT: Nếu không match pattern nào
    // ═══════════════════════════════════════════════════════════

    if (beforeCall.length > 0 && !/^\s*$/.test(beforeCall)) {
      return true;
    }

    // Nếu không có gì trước function call → standalone
    return false;
  }

  private async findFunctionCallsWithReturnUsage(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol,
    nodeMap: Map<string, Node>
  ): Promise<Array<{ target: string; usesReturnValue: boolean }>> {
    const callees: Array<{ target: string; usesReturnValue: boolean }> = [];
    const text = document.getText(symbol.range);
    const lines = text.split("\n");

    const functionCallRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      if (lineIndex === 0) {
        continue;
      }

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
                  const targetType = this.getNodeType(targetSymbol.kind);
                  const targetId = `${targetType}_${targetSymbol.name}`;

                  const sourceType = this.getNodeType(symbol.kind);
                  const sourceId = `${sourceType}_${symbol.name}`;

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
            } else {
              Logger.error(
                `External call detected: ${functionName} (in ${def.uri.fsPath})`
              );
            }
          }
        } catch (error) {
          Logger.error(`Could not resolve definition for: ${functionName}`);
        }
      }
    }

    return callees;
  }

  private findParentSymbol(
    allSymbols: vscode.DocumentSymbol[],
    targetSymbol: vscode.DocumentSymbol
  ): vscode.DocumentSymbol | undefined {
    for (const symbol of allSymbols) {
      if (symbol.children && symbol.children.length > 0) {
        if (symbol.children.includes(targetSymbol)) {
          return symbol;
        }
        const found = this.findParentSymbol(symbol.children, targetSymbol);
        if (found) return found;
      }
    }
    return undefined;
  }

  private async findDeclarationUsages(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol,
    declarationSymbols: vscode.DocumentSymbol[]
  ): Promise<
    Array<{ declarationSymbol: vscode.DocumentSymbol; usageCount: number }>
  > {
    const usages: Map<
      string,
      { symbol: vscode.DocumentSymbol; count: number }
    > = new Map();

    const text = document.getText(symbol.range);
    const lines = text.split("\n");

    // Pattern để detect type usage: var x Type, func() Type, Type{}, etc.
    const typeUsageRegex = /\b([A-Z][a-zA-Z0-9_]*)\b/g;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      let match;

      while ((match = typeUsageRegex.exec(line)) !== null) {
        const typeName = match[1];

        // Tìm declaration symbol với tên này trong declarationSymbols
        const declarationSymbol = declarationSymbols.find(
          (s) => s.name === typeName
        );

        if (declarationSymbol) {
          const key = `${declarationSymbol.kind}_${declarationSymbol.name}`;

          if (!usages.has(key)) {
            usages.set(key, { symbol: declarationSymbol, count: 0 });
          }

          usages.get(key)!.count++;
        }
      }
    }

    return Array.from(usages.values()).map((usage) => ({
      declarationSymbol: usage.symbol,
      usageCount: usage.count,
    }));
  }

  private isDeclaration(symbol: vscode.DocumentSymbol): boolean {
    return (
      symbol.kind === vscode.SymbolKind.Class ||
      symbol.kind === vscode.SymbolKind.Struct ||
      symbol.kind === vscode.SymbolKind.Interface ||
      symbol.kind === vscode.SymbolKind.Enum
    );
  }

  async parseFunctionWithDependencies(
    document: vscode.TextDocument,
    functionInfo: { name: string; symbol: vscode.DocumentSymbol }
  ): Promise<GraphData> {
    try {
      const allNodes = new Map<string, Node>();
      const allEdges: Edge[] = [];
      const edgeMap = new Map<string, Set<string>>();
      const visitedFiles = new Set<string>();
      const functionQueue: Array<{
        symbol: vscode.DocumentSymbol;
        document: vscode.TextDocument;
      }> = [];
      const declarationUsageMap = new Map<string, Set<string>>();

      // Step 1: Thêm root function vào queue
      const rootNode = this.createNodeFromSymbol(functionInfo.symbol, document);
      allNodes.set(rootNode.id, rootNode);
      functionQueue.push({ symbol: functionInfo.symbol, document });
      visitedFiles.add(document.uri.fsPath);

      // Step 2: BFS để traverse tất cả function dependencies
      while (functionQueue.length > 0) {
        const { symbol, document: currentDoc } = functionQueue.shift()!;
        const currentNode = this.createNodeFromSymbol(symbol, currentDoc);

        // Get all symbols from current document
        const currentDocSymbols = await this.getDocumentSymbols(currentDoc);
        const declarationSymbols = currentDocSymbols.filter((s) =>
          this.isDeclaration(s)
        );

        // Tìm function calls
        const callees = await this.findFunctionCallsForTraversal(
          currentDoc,
          symbol
        );

        for (const callee of callees) {
          // Thêm edge
          if (!edgeMap.has(currentNode.id)) {
            edgeMap.set(currentNode.id, new Set());
          }

          if (!edgeMap.get(currentNode.id)!.has(callee.targetId)) {
            allEdges.push({
              source: currentNode.id,
              target: callee.targetId,
              type: "calls",
              hasReturnValue: callee.usesReturnValue,
            });
            edgeMap.get(currentNode.id)!.add(callee.targetId);
          }

          // Thêm target node nếu chưa có
          if (!allNodes.has(callee.targetId)) {
            const targetNode = this.createNodeFromSymbol(
              callee.targetSymbol,
              callee.targetDocument
            );
            allNodes.set(targetNode.id, targetNode);

            functionQueue.push({
              symbol: callee.targetSymbol,
              document: callee.targetDocument,
            });
          }
        }

        // Tìm declaration usages
        const declarations = await this.findDeclarationUsages(
          currentDoc,
          symbol,
          declarationSymbols
        );

        for (const { declarationSymbol } of declarations) {
          const declType = this.getNodeType(declarationSymbol.kind);
          const declId = `${declType}_${declarationSymbol.name}`;

          if (!declarationUsageMap.has(declId)) {
            declarationUsageMap.set(declId, new Set());
          }
          declarationUsageMap.get(declId)!.add(currentNode.id);
        }
      }

      // Step 3: Tạo DeclarationNodes dựa trên usage
      let declarationIndex = 0;
      for (const [baseDeclarationId, usedByFunctions] of declarationUsageMap) {
        // Tìm declarationSymbol từ visited documents
        for (const filePath of visitedFiles) {
          try {
            const fileUri = vscode.Uri.file(filePath);
            const fileDoc = await vscode.workspace.openTextDocument(fileUri);
            const fileSymbols = await this.getDocumentSymbols(fileDoc);

            const declarationSymbol = fileSymbols.find((s) => {
              const type = this.getNodeType(s.kind);
              const id = `${type}_${s.name}`;
              return id === baseDeclarationId && this.isDeclaration(s);
            });

            if (declarationSymbol) {
              usedByFunctions.forEach((functionId) => {
                const uniqueDeclarationId = `${baseDeclarationId}_usage_${declarationIndex++}`;

                const declarationNode = this.createNodeFromSymbol(
                  declarationSymbol,
                  fileDoc
                );

                declarationNode.id = uniqueDeclarationId;
                (declarationNode as any).usedBy = [functionId];
                (declarationNode as any).baseDeclarationId = baseDeclarationId;

                allNodes.set(uniqueDeclarationId, declarationNode);

                allEdges.push({
                  source: functionId,
                  target: uniqueDeclarationId,
                  type: "uses",
                });
              });

              break; // Found declaration, no need to search other files
            }
          } catch (error) {
            Logger.error(`Failed to process file: ${filePath}`, error);
          }
        }
      }

      return {
        nodes: Array.from(allNodes.values()),
        edges: allEdges,
        fileName: document.fileName,
      };
    } catch (error) {
      Logger.error(
        `[GoParser] Failed to parse function ${functionInfo.name} with dependencies`,
        error
      );
      throw error;
    }
  }

  private async findFunctionCallsForTraversal(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol
  ): Promise<
    Array<{
      targetId: string;
      targetSymbol: vscode.DocumentSymbol;
      targetDocument: vscode.TextDocument;
      crossFile: boolean;
      usesReturnValue: boolean;
    }>
  > {
    const callees: Array<{
      targetId: string;
      targetSymbol: vscode.DocumentSymbol;
      targetDocument: vscode.TextDocument;
      crossFile: boolean;
      usesReturnValue: boolean;
    }> = [];

    const text = document.getText(symbol.range);
    const lines = text.split("\n");
    const functionCallRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
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
            const filePath = def.uri.fsPath;

            // Bỏ qua stdlib và vendor
            if (
              filePath.includes("/usr/local/go/") ||
              filePath.includes("/go/pkg/mod/") ||
              filePath.includes("\\go\\pkg\\mod\\") ||
              filePath.includes("/vendor/") ||
              !filePath.endsWith(".go")
            ) {
              continue;
            }

            const isCrossFile = def.uri.fsPath !== document.uri.fsPath;

            try {
              const defDocument = await vscode.workspace.openTextDocument(
                def.uri
              );
              const defSymbols = await vscode.commands.executeCommand<
                vscode.DocumentSymbol[]
              >("vscode.executeDocumentSymbolProvider", def.uri);

              if (defSymbols) {
                const targetSymbol = this.findSymbolAtPosition(
                  defSymbols,
                  def.range.start
                );

                if (targetSymbol && this.isFunctionOrMethod(targetSymbol)) {
                  const targetType = this.getNodeType(targetSymbol.kind);
                  const targetId = `${targetType}_${targetSymbol.name}`;

                  const sourceType = this.getNodeType(symbol.kind);
                  const sourceId = `${sourceType}_${symbol.name}`;

                  if (targetId !== sourceId) {
                    const usesReturnValue = this.detectReturnValueUsage(
                      line,
                      charIndex,
                      functionName
                    );

                    callees.push({
                      targetId,
                      targetSymbol,
                      targetDocument: defDocument,
                      crossFile: isCrossFile,
                      usesReturnValue,
                    });
                  }
                }
              }
            } catch (error) {
              Logger.error(
                `Could not open or analyze target file: ${def.uri.fsPath}`
              );
            }
          }
        } catch (error) {
          Logger.error(`Could not resolve definition for: ${functionName}`);
        }
      }
    }

    return callees;
  }

  private async findDirectDependencies(
    document: vscode.TextDocument
  ): Promise<Set<string>> {
    const dependencies = new Set<string>();
    const symbols = await this.getDocumentSymbols(document);

    for (const symbol of symbols) {
      if (this.isFunctionOrMethod(symbol)) {
        const text = document.getText(symbol.range);
        const lines = text.split("\n");
        const functionCallRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
          const line = lines[lineIndex];
          let match;

          while ((match = functionCallRegex.exec(line)) !== null) {
            const charIndex = match.index;
            const absoluteLine = symbol.range.start.line + lineIndex;
            const position = new vscode.Position(absoluteLine, charIndex);

            try {
              const definitions = await vscode.commands.executeCommand<
                vscode.Location[]
              >("vscode.executeDefinitionProvider", document.uri, position);

              if (definitions && definitions.length > 0) {
                const def = definitions[0];
                const filePath = def.uri.fsPath;

                // Chỉ lấy files trong project (bỏ qua stdlib và vendor)
                if (
                  filePath !== document.uri.fsPath &&
                  !filePath.includes("/usr/local/go/") &&
                  !filePath.includes("/go/pkg/mod/") &&
                  !filePath.includes("\\go\\pkg\\mod\\") &&
                  !filePath.includes("/vendor/") &&
                  filePath.endsWith(".go")
                ) {
                  dependencies.add(filePath);
                }
              }
            } catch (error) {
              // Ignore errors khi resolve definition
            }
          }
        }
      }
    }

    return dependencies;
  }

  private async findFunctionCallsWithNodeMap(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol,
    nodeMap: Map<string, Node>
  ): Promise<Array<{ target: string; crossFile: boolean }>> {
    const callees: Array<{ target: string; crossFile: boolean }> = [];
    const text = document.getText(symbol.range);
    const lines = text.split("\n");
    const functionCallRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
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
            const isCrossFile = def.uri.fsPath !== document.fileName;

            const defDocument = await vscode.workspace.openTextDocument(
              def.uri
            );
            const defSymbols = await vscode.commands.executeCommand<
              vscode.DocumentSymbol[]
            >("vscode.executeDocumentSymbolProvider", def.uri);

            if (defSymbols) {
              const targetSymbol = this.findSymbolAtPosition(
                defSymbols,
                def.range.start
              );

              if (targetSymbol && this.isFunctionOrMethod(targetSymbol)) {
                const targetType = this.getNodeType(targetSymbol.kind);
                const targetId = `${targetType}_${targetSymbol.name}`;

                const sourceType = this.getNodeType(symbol.kind);
                const sourceId = `${sourceType}_${symbol.name}`;

                if (nodeMap.has(targetId) && targetId !== sourceId) {
                  callees.push({ target: targetId, crossFile: isCrossFile });
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

  private async getDocumentSymbols(
    document: vscode.TextDocument
  ): Promise<vscode.DocumentSymbol[]> {
    const symbols = await vscode.commands.executeCommand<
      vscode.DocumentSymbol[]
    >("vscode.executeDocumentSymbolProvider", document.uri);
    return symbols || [];
  }

  private isFunctionOrMethod(symbol: vscode.DocumentSymbol): boolean {
    return (
      symbol.kind === vscode.SymbolKind.Function ||
      symbol.kind === vscode.SymbolKind.Method
    );
  }

  private createNodeFromSymbol(
    symbol: vscode.DocumentSymbol,
    document: vscode.TextDocument,
    parentSymbol?: vscode.DocumentSymbol
  ): Node {
    const nodeType = this.getNodeType(symbol.kind);
    const cleanName = this.extractCleanFunctionName(symbol.name);
    const id = `${nodeType}_${cleanName}`;
    const code = document.getText(symbol.range);

    // Phát hiện language từ file extension
    const language = this.detectLanguage(document.fileName);

    // Phát hiện return type và nested function
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
      code: code,
      language,
      returnType,
      hasReturnValue,
      isNested,
      parentNodeId,
    };
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

    // Go: func name() returnType
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

    // Python: def name() -> returnType:
    if (language === "python") {
      const pyReturnMatch = firstLine.match(/->\s*([^:]+):/);
      if (pyReturnMatch) {
        const returnPart = pyReturnMatch[1].trim();
        return {
          returnType: returnPart,
          hasReturnValue: returnPart !== "None",
        };
      }
      // Nếu không có annotation, kiểm tra có return statement
      return {
        returnType: "unknown",
        hasReturnValue: /\breturn\s+[^;\n]+/.test(code),
      };
    }

    // JavaScript/TypeScript: function name(): returnType
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

    // Java/C#/Kotlin: returnType name()
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

    // Default: kiểm tra có return statement
    return {
      returnType: "unknown",
      hasReturnValue: /\breturn\s+[^;\n]+/.test(code),
    };
  }

  private extractCleanFunctionName(fullName: string): string {
    const methodPattern = /\(.*?\)\s+(\w+)/;
    const match = fullName.match(methodPattern);
    if (match) {
      return match[1];
    }
    return fullName;
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
    switch (kind) {
      case vscode.SymbolKind.Function:
        return "function";
      case vscode.SymbolKind.Method:
        return "method";
      case vscode.SymbolKind.Class:
        return "class";
      case vscode.SymbolKind.Struct:
        return "struct";
      case vscode.SymbolKind.Interface:
        return "interface";
      case vscode.SymbolKind.Enum:
        return "enum";
      case vscode.SymbolKind.TypeParameter:
        return "type";
      default:
        return "unknown";
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
          if (childSymbol) {
            return childSymbol;
          }
        }
        return symbol;
      }
    }
    return undefined;
  }
}
