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

      // === PASS 1: Tạo tất cả nodes trước (để có hasReturnValue) ===
      for (const symbol of symbols) {
        if (this.isFunctionOrMethod(symbol)) {
          // Bỏ qua nested functions
          const parentSymbol = this.findParentSymbol(symbols, symbol);
          if (parentSymbol && this.isFunctionOrMethod(parentSymbol)) {
            Logger.debug(
              `[GoParser] Skipping nested function: ${symbol.name} (parent: ${parentSymbol.name})`
            );
            continue;
          }

          const node = this.createNodeFromSymbol(symbol, document);
          nodes.push(node);
        } else if (this.isTypeOrInterface(symbol)) {
          const config = vscode.workspace.getConfiguration("goflow");
          if (
            (symbol.kind === vscode.SymbolKind.Struct &&
              config.get("showTypes")) ||
            (symbol.kind === vscode.SymbolKind.Interface &&
              config.get("showInterfaces"))
          ) {
            nodes.push(this.createNodeFromSymbol(symbol, document));
          }
        }
      }

      // Tạo node map để lookup nhanh
      const nodeMap = new Map<string, Node>();
      nodes.forEach((node) => nodeMap.set(node.id, node));

      // === PASS 2: Tạo edges với hasReturnValue chính xác ===
      for (const symbol of symbols) {
        if (this.isFunctionOrMethod(symbol)) {
          // Bỏ qua nested functions
          const parentSymbol = this.findParentSymbol(symbols, symbol);
          if (parentSymbol && this.isFunctionOrMethod(parentSymbol)) {
            Logger.debug(
              `[GoParser] Skipping nested function: ${symbol.name} (parent: ${parentSymbol.name})`
            );
            continue;
          }

          const nodeType = this.getNodeType(symbol.kind);
          const cleanName = this.extractCleanFunctionName(symbol.name);
          const nodeId = `${nodeType}_${cleanName}`;

          // ✅ CRITICAL: Phải dùng findFunctionCallsWithReturnUsage, KHÔNG phải findFunctionCallsWithLSP
          const callees = await this.findFunctionCallsWithReturnUsage(
            document,
            symbol,
            nodeMap
          );

          Logger.debug(
            `[GoParser] Function ${nodeId} has ${callees.length} callees`
          );

          for (const callee of callees) {
            const edgeKey = `${nodeId}->${callee.target}`;
            if (!edgeMap.has(nodeId)) {
              edgeMap.set(nodeId, new Set());
            }

            if (!edgeMap.get(nodeId)!.has(callee.target)) {
              // ✅ LOG: Xác nhận edge được tạo với hasReturnValue
              Logger.debug(`[GoParser] Creating edge: ${edgeKey}`);
              Logger.debug(
                `[GoParser] → usesReturnValue: ${callee.usesReturnValue}`
              );

              edges.push({
                source: nodeId,
                target: callee.target,
                type: "calls",
                hasReturnValue: callee.usesReturnValue, // ✅ MUST HAVE THIS
              });
              edgeMap.get(nodeId)!.add(callee.target);
            }
          }
        }
      }

      const validNodeIds = new Set(nodes.map((n) => n.id));
      const validEdges = edges.filter((edge) => {
        const isValid =
          validNodeIds.has(edge.source) && validNodeIds.has(edge.target);
        if (!isValid) {
          Logger.error(
            `Removed invalid edge: ${edge.source} -> ${edge.target} (target not in current file)`
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
    const trimmedLine = line.trim();

    // ✅ Đoạn từ đầu line đến sau function call (bao gồm cả tên function)
    const lineUpToCall = line.substring(0, callPosition + functionName.length);

    Logger.debug(`[GoParser.detectReturnValueUsage] Function: ${functionName}`);
    Logger.debug(`[GoParser.detectReturnValueUsage] Full line: "${line}"`);
    Logger.debug(
      `[GoParser.detectReturnValueUsage] Before call: "${beforeCall}"`
    );
    Logger.debug(
      `[GoParser.detectReturnValueUsage] Line up to call: "${lineUpToCall}"`
    );

    // ═══════════════════════════════════════════════════════════
    // PRIORITY 1: Check TOÀN BỘ LINE cho assignment patterns
    // ═══════════════════════════════════════════════════════════

    // Pattern 1a: Short variable declaration (:=) trong toàn bộ line up to call
    if (/:=/.test(lineUpToCall)) {
      Logger.debug(
        `[GoParser.detectReturnValueUsage] → USED (short variable declaration :=)`
      );
      return true;
    }

    // Pattern 1b: Regular assignment (=) trong toàn bộ line up to call
    if (/[^=!<>]=(?!=)/.test(lineUpToCall)) {
      Logger.debug(
        `[GoParser.detectReturnValueUsage] → USED (regular assignment =)`
      );
      return true;
    }

    // ═══════════════════════════════════════════════════════════
    // PRIORITY 2: Check beforeCall cho immediate context
    // ═══════════════════════════════════════════════════════════

    // Pattern 2: Return statement
    if (/\breturn\s+$/.test(beforeCall)) {
      Logger.debug(
        `[GoParser.detectReturnValueUsage] → USED (return statement)`
      );
      return true;
    }

    // Pattern 3: Comparison operators
    if (/[!=<>]+\s*$/.test(beforeCall)) {
      Logger.debug(`[GoParser.detectReturnValueUsage] → USED (comparison)`);
      return true;
    }

    // Pattern 4: Function argument hoặc nested call
    if (/[,(]\s*$/.test(beforeCall)) {
      Logger.debug(
        `[GoParser.detectReturnValueUsage] → USED (function argument)`
      );
      return true;
    }

    // Pattern 5: If/for/switch condition
    if (/\b(if|for|switch)\s*\(\s*$/.test(beforeCall)) {
      Logger.debug(`[GoParser.detectReturnValueUsage] → USED (condition)`);
      return true;
    }

    // ═══════════════════════════════════════════════════════════
    // PRIORITY 3: Detect STANDALONE CALL (không dùng return value)
    // ═══════════════════════════════════════════════════════════

    // Pattern 6: Defer, go statements (không dùng return value)
    if (/\b(defer|go)\s+$/.test(beforeCall)) {
      Logger.debug(`[GoParser.detectReturnValueUsage] → NOT USED (defer/go)`);
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
      Logger.debug(
        `[GoParser.detectReturnValueUsage] → NOT USED (standalone call)`
      );
      return false;
    }

    // Pattern 8: Inside block start (statement sau dấu {)
    if (/{\s*$/.test(beforeCall)) {
      Logger.debug(
        `[GoParser.detectReturnValueUsage] → NOT USED (inside block)`
      );
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
        Logger.debug(
          `[GoParser.detectReturnValueUsage] → NOT USED (logging call)`
        );
        return false;
      }
    }

    // ═══════════════════════════════════════════════════════════
    // DEFAULT: Nếu không match pattern nào
    // ═══════════════════════════════════════════════════════════

    if (beforeCall.length > 0 && !/^\s*$/.test(beforeCall)) {
      Logger.debug(
        `[GoParser.detectReturnValueUsage] → USED (complex context - default assume used)`
      );
      return true;
    }

    // Nếu không có gì trước function call → standalone
    Logger.debug(`[GoParser.detectReturnValueUsage] → NOT USED (no context)`);
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

        Logger.debug(
          `[GoParser] Found function call: ${functionName} at line ${lineIndex}, char ${charIndex}`
        );
        Logger.debug(`[GoParser] Line content: "${line}"`);

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
                    // ✅ Phát hiện xem return value có được sử dụng không
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

  async parseFileWithDependencies(
    document: vscode.TextDocument
  ): Promise<GraphData> {
    try {
      // Step 1: Parse file hiện tại để lấy nodes và tìm external calls
      const currentFileData = await this.parseFile(document);
      const allNodes = new Map<string, Node>();
      const allEdges: Edge[] = [];
      const edgeMap = new Map<string, Set<string>>();

      // Thêm nodes từ file hiện tại
      currentFileData.nodes.forEach((node) => {
        allNodes.set(node.id, node);
      });

      // Thêm edges từ file hiện tại
      currentFileData.edges.forEach((edge) => {
        allEdges.push(edge);
        if (!edgeMap.has(edge.source)) {
          edgeMap.set(edge.source, new Set());
        }
        edgeMap.get(edge.source)!.add(edge.target);
      });

      // Step 2: Tìm tất cả external calls từ file hiện tại
      const externalFiles = await this.findDirectDependencies(document);

      // Step 3: Parse các external files để lấy function definitions
      for (const filePath of externalFiles) {
        try {
          const extUri = vscode.Uri.file(filePath);
          const extDoc = await vscode.workspace.openTextDocument(extUri);
          const extSymbols = await this.getDocumentSymbols(extDoc);

          for (const symbol of extSymbols) {
            if (this.isFunctionOrMethod(symbol)) {
              const node = this.createNodeFromSymbol(symbol, extDoc);
              if (!allNodes.has(node.id)) {
                allNodes.set(node.id, node);
              }
            }
          }
        } catch (error) {
          Logger.error(`Failed to parse external file: ${filePath}`, error);
        }
      }

      // Step 4: Re-analyze calls từ file hiện tại với đầy đủ node map
      for (const symbol of await this.getDocumentSymbols(document)) {
        if (this.isFunctionOrMethod(symbol)) {
          const node = this.createNodeFromSymbol(symbol, document);
          const callees = await this.findFunctionCallsWithNodeMap(
            document,
            symbol,
            allNodes
          );

          for (const callee of callees) {
            const edgeKey = `${node.id}->${callee.target}`;

            if (!edgeMap.has(node.id)) {
              edgeMap.set(node.id, new Set());
            }

            if (!edgeMap.get(node.id)!.has(callee.target)) {
              allEdges.push({
                source: node.id,
                target: callee.target,
                type: "calls",
              });
              edgeMap.get(node.id)!.add(callee.target);
            }
          }
        }
      }

      return {
        nodes: Array.from(allNodes.values()),
        edges: allEdges,
        fileName: document.fileName,
      };
    } catch (error) {
      Logger.error("Failed to parse file with dependencies", error);
      throw error;
    }
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

      // Step 1: Thêm root function vào queue
      const rootNode = this.createNodeFromSymbol(functionInfo.symbol, document);
      allNodes.set(rootNode.id, rootNode);
      functionQueue.push({ symbol: functionInfo.symbol, document });
      visitedFiles.add(document.uri.fsPath);

      // Step 2: BFS để traverse tất cả dependencies
      while (functionQueue.length > 0) {
        const { symbol, document: currentDoc } = functionQueue.shift()!;
        const currentNode = this.createNodeFromSymbol(symbol, currentDoc);

        // Tìm tất cả function calls trong function hiện tại
        const callees = await this.findFunctionCallsForTraversal(
          currentDoc,
          symbol
        );

        Logger.debug(
          `[GoParser] Processing ${currentNode.id}: found ${callees.length} callees`
        );

        for (const callee of callees) {
          // Thêm edge
          if (!edgeMap.has(currentNode.id)) {
            edgeMap.set(currentNode.id, new Set());
          }

          if (!edgeMap.get(currentNode.id)!.has(callee.targetId)) {
            // ✅ LOG & ADD hasReturnValue
            Logger.debug(
              `[GoParser] Edge: ${currentNode.id} → ${callee.targetId}`
            );
            Logger.debug(
              `[GoParser] → usesReturnValue: ${callee.usesReturnValue}`
            );

            allEdges.push({
              source: currentNode.id,
              target: callee.targetId,
              type: "calls",
              hasReturnValue: callee.usesReturnValue, // ✅ PHẢI CÓ
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

            // Thêm vào queue để tiếp tục traverse
            functionQueue.push({
              symbol: callee.targetSymbol,
              document: callee.targetDocument,
            });
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
      usesReturnValue: boolean; // ✅ THÊM FIELD NÀY
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
                    // ✅ DETECT RETURN VALUE USAGE
                    const usesReturnValue = this.detectReturnValueUsage(
                      line,
                      charIndex,
                      functionName
                    );

                    Logger.debug(
                      `[GoParser] Call: ${functionName} → usesReturnValue: ${usesReturnValue}`
                    );

                    callees.push({
                      targetId,
                      targetSymbol,
                      targetDocument: defDocument,
                      crossFile: isCrossFile,
                      usesReturnValue, // ✅ THÊM VÀO ĐÂY
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

  private isTypeOrInterface(symbol: vscode.DocumentSymbol): boolean {
    return (
      symbol.kind === vscode.SymbolKind.Struct ||
      symbol.kind === vscode.SymbolKind.Interface ||
      symbol.kind === vscode.SymbolKind.Class
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
  ): "function" | "method" | "struct" | "interface" | "unknown" {
    switch (kind) {
      case vscode.SymbolKind.Function:
        return "function";
      case vscode.SymbolKind.Method:
        return "method";
      case vscode.SymbolKind.Struct:
        return "struct";
      case vscode.SymbolKind.Interface:
        return "interface";
      default:
        return "unknown";
    }
  }

  private async findFunctionCallsWithLSP(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol
  ): Promise<Array<{ target: string }>> {
    const callees: Array<{ target: string }> = [];
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
                    callees.push({ target: targetId });
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

  async parseMultipleFiles(
    documents: vscode.TextDocument[]
  ): Promise<GraphData> {
    const allNodes: Node[] = [];
    const allEdges: Edge[] = [];
    const nodeMap = new Map<string, Node>();
    const edgeMap = new Map<string, Set<string>>();

    // Step 1: Parse tất cả files để lấy nodes
    for (const doc of documents) {
      try {
        const symbols = await this.getDocumentSymbols(doc);

        for (const symbol of symbols) {
          if (this.isFunctionOrMethod(symbol)) {
            const node = this.createNodeFromSymbol(symbol, doc);
            if (!nodeMap.has(node.id)) {
              nodeMap.set(node.id, node);
              allNodes.push(node);
            }
          }
        }
      } catch (error) {
        Logger.error(`Failed to parse file: ${doc.fileName}`, error);
      }
    }

    // Step 2: Tìm edges (bao gồm cross-file calls)
    for (const doc of documents) {
      try {
        const symbols = await this.getDocumentSymbols(doc);

        for (const symbol of symbols) {
          if (this.isFunctionOrMethod(symbol)) {
            const node = this.createNodeFromSymbol(symbol, doc);
            const callees = await this.findFunctionCallsCrossFile(
              doc,
              symbol,
              nodeMap
            );

            for (const callee of callees) {
              if (!edgeMap.has(node.id)) {
                edgeMap.set(node.id, new Set());
              }

              if (!edgeMap.get(node.id)!.has(callee.target)) {
                allEdges.push({
                  source: node.id,
                  target: callee.target,
                  type: "calls",
                });
                edgeMap.get(node.id)!.add(callee.target);
              }
            }
          }
        }
      } catch (error) {
        Logger.error(`Failed to analyze calls in file: ${doc.fileName}`, error);
      }
    }

    return {
      nodes: allNodes,
      edges: allEdges,
      fileName: documents[0].fileName,
    };
  }

  private async findFunctionCallsCrossFile(
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

                  if (nodeMap.has(targetId) && targetId !== sourceId) {
                    callees.push({ target: targetId, crossFile: isCrossFile });
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
}
