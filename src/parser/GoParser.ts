// src/parser/GoParser.ts
import * as vscode from "vscode";
import { GraphData, Node, Edge } from "../models/Node";
import { Logger } from "../utils/logger";
import { EdgeDetector, EdgeDetectionContext } from "./EdgeDetector";
import { DeclarationDetector } from "./DeclarationDetector";
import { NodeFactory } from "./NodeFactory";
import { CallOrderTracker } from "./CallOrderTracker";

export class GoParser {
  private edgeDetector: EdgeDetector;
  private declarationDetector: DeclarationDetector;
  private nodeFactory: NodeFactory;
  private callOrderTracker: CallOrderTracker;

  constructor() {
    this.edgeDetector = new EdgeDetector();
    this.declarationDetector = new DeclarationDetector();
    this.nodeFactory = new NodeFactory();
    this.callOrderTracker = new CallOrderTracker();
  }

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

          const node = this.nodeFactory.createNodeFromSymbol(symbol, document);
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

        // Tìm function calls using EdgeDetector
        const edgeContext: EdgeDetectionContext = {
          document,
          symbol,
          nodeMap,
        };

        const callees =
          await this.edgeDetector.findFunctionCallsWithReturnUsage(edgeContext);

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

        // Tìm declaration usages using DeclarationDetector
        const declarations =
          await this.declarationDetector.findDeclarationUsages(
            document,
            symbol,
            declarationSymbols
          );

        for (const { declarationSymbol, usageCount } of declarations) {
          const declType = this.getNodeType(declarationSymbol.kind);
          const declId = `${declType}_${declarationSymbol.name}`;

          if (!declarationUsageMap.has(declId)) {
            declarationUsageMap.set(declId, new Set());
          }
          declarationUsageMap.get(declId)!.add(functionNode.id);

          // LƯU THÔNG TIN DECLARATION SYMBOL ĐỂ TẠO NODE SAU
          const symbolKey = `${declId}_symbol`;
          if (!declarationUsageMap.has(symbolKey)) {
            (declarationUsageMap as any).set(symbolKey, declarationSymbol);
          }
        }
      }

      const symbolStorage = new Map<string, vscode.DocumentSymbol>();
      const usageStorage = new Map<string, Set<string>>();

      declarationUsageMap.forEach((value, key) => {
        if (key.endsWith("_symbol")) {
          const baseKey = key.replace("_symbol", "");
          symbolStorage.set(baseKey, value as any);
        } else if (value instanceof Set) {
          usageStorage.set(key, value);
        }
      });

      let declarationIndex = 0;
      usageStorage.forEach((usedByFunctions, baseDeclarationId) => {
        const declarationSymbol = symbolStorage.get(baseDeclarationId);

        if (!declarationSymbol) {
          Logger.warn(
            `[parseFile PASS3] ❌ Symbol not found for "${baseDeclarationId}"`
          );
          return;
        }

        usedByFunctions.forEach((functionId) => {
          const uniqueDeclarationId = `${baseDeclarationId}_usage_${declarationIndex++}`;

          const declarationNode = this.nodeFactory.createNodeFromSymbol(
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
      const declarationSymbolMap = new Map<
        string,
        { symbol: vscode.DocumentSymbol; document: vscode.TextDocument }
      >();

      // Step 1: Thêm root function vào queue
      const rootNode = this.nodeFactory.createNodeFromSymbol(
        functionInfo.symbol,
        document
      );
      allNodes.set(rootNode.id, rootNode);
      functionQueue.push({ symbol: functionInfo.symbol, document });
      visitedFiles.add(document.uri.fsPath);

      // Step 2: BFS để traverse tất cả function dependencies
      while (functionQueue.length > 0) {
        const { symbol, document: currentDoc } = functionQueue.shift()!;
        const currentNode = this.nodeFactory.createNodeFromSymbol(
          symbol,
          currentDoc
        );

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
            const targetNode = this.nodeFactory.createNodeFromSymbol(
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

        // Tìm declaration usages (bây giờ hỗ trợ cross-file)
        const declarations =
          await this.declarationDetector.findDeclarationUsages(
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

          if (!declarationSymbolMap.has(declId)) {
            declarationSymbolMap.set(declId, {
              symbol: declarationSymbol,
              document: currentDoc,
            });
          }
        }
      }

      // Step 3: Analyze call order execution flow
      Logger.info(
        `[GoParser] 📊 Analyzing call order for root: ${functionInfo.name}`
      );
      Logger.info(
        `[GoParser] 📊 Total edges before call order analysis: ${allEdges.length}`
      );

      const callOrderMap = await this.callOrderTracker.analyzeExecutionFlow(
        functionInfo.symbol,
        document,
        await this.getDocumentSymbols(document),
        allEdges
      );

      Logger.info(`[GoParser] 📊 CallOrderMap size: ${callOrderMap.size}`);

      // Apply call orders to edges
      let edgesWithCallOrder = 0;
      allEdges.forEach((edge) => {
        const edgeKey = `${edge.source}->${edge.target}`;
        const orderInfo = callOrderMap.get(edgeKey);

        if (orderInfo) {
          // ✅ THAY ĐỔI: Lưu vào edge property (giữ nguyên như cũ)
          if (orderInfo.callOrder !== undefined) {
            edge.callOrder = orderInfo.callOrder;
            edgesWithCallOrder++;
            Logger.info(
              `[GoParser] ✅ Assigned callOrder=${orderInfo.callOrder} to edge: ${edgeKey}`
            );
          }
          if (orderInfo.returnOrder !== undefined) {
            edge.returnOrder = orderInfo.returnOrder;
            Logger.info(
              `[GoParser] ✅ Assigned returnOrder=${orderInfo.returnOrder} to edge: ${edgeKey}`
            );
          }
        } else {
          Logger.warn(
            `[GoParser] ⚠️ No call order info found for edge: ${edgeKey}`
          );
        }
      });

      Logger.info(
        `[GoParser] ✅ Assigned call orders to ${edgesWithCallOrder}/${allEdges.length} edges`
      );

      // Step 4: Tạo DeclarationNodes dựa trên usage
      let declarationIndex = 0;
      declarationUsageMap.forEach((usedByFunctions, baseDeclarationId) => {
        const declarationInfo = declarationSymbolMap.get(baseDeclarationId);

        if (!declarationInfo) {
          Logger.warn(
            `[parseFunctionWithDependencies PASS3] ❌ Symbol not found for "${baseDeclarationId}"`
          );
          return;
        }

        const { symbol: declarationSymbol, document: declDocument } =
          declarationInfo;

        usedByFunctions.forEach((functionId) => {
          const uniqueDeclarationId = `${baseDeclarationId}_usage_${declarationIndex++}`;

          const declarationNode = this.nodeFactory.createNodeFromSymbol(
            declarationSymbol,
            declDocument
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
      });

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

  // ==================== HELPER METHODS ====================

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
                    const usesReturnValue =
                      this.edgeDetector.detectReturnValueUsage(
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

  private isDeclaration(symbol: vscode.DocumentSymbol): boolean {
    return (
      symbol.kind === vscode.SymbolKind.Class ||
      symbol.kind === vscode.SymbolKind.Struct ||
      symbol.kind === vscode.SymbolKind.Interface ||
      symbol.kind === vscode.SymbolKind.Enum
    );
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

  private extractCleanFunctionName(fullName: string): string {
    const methodPattern = /\(.*?\)\s+(\w+)/;
    const match = fullName.match(methodPattern);
    if (match) {
      return match[1];
    }
    return fullName;
  }
}
