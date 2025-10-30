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

      for (const symbol of symbols) {
        if (this.isFunctionOrMethod(symbol)) {
          const node = this.createNodeFromSymbol(symbol, document);
          nodes.push(node);

          const callees = await this.findFunctionCallsWithLSP(document, symbol);

          for (const callee of callees) {
            const edgeKey = `${node.id}->${callee.target}`;
            if (!edgeMap.has(node.id)) {
              edgeMap.set(node.id, new Set());
            }

            if (!edgeMap.get(node.id)!.has(callee.target)) {
              edges.push({
                source: node.id,
                target: callee.target,
                type: "calls",
              });
              edgeMap.get(node.id)!.add(callee.target);
            }
          }
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

      const validNodeIds = new Set(nodes.map((n) => n.id));
      const validEdges = edges.filter((edge) => {
        const isValid =
          validNodeIds.has(edge.source) && validNodeIds.has(edge.target);
        if (!isValid) {
          Logger.debug(
            `Removed invalid edge: ${edge.source} -> ${edge.target} (target not in current file)`
          );
        }
        return isValid;
      });

      Logger.info(
        `Parsed ${nodes.length} nodes and ${validEdges.length} edges (${
          edges.length - validEdges.length
        } external calls filtered)`
      );

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
    document: vscode.TextDocument
  ): Node {
    const nodeType = this.getNodeType(symbol.kind);
    const id = `${nodeType}_${symbol.name}`;

    return {
      id,
      label: symbol.name,
      type: nodeType,
      file: document.fileName,
      line: symbol.range.start.line + 1,
      kind: symbol.kind,
    };
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

                  callees.push({ target: targetId });
                  Logger.debug(
                    `Found call: ${symbol.name} -> ${targetSymbol.name} (via LSP)`
                  );
                }
              }
            } else {
              Logger.debug(
                `External call detected: ${functionName} (in ${def.uri.fsPath})`
              );
            }
          }
        } catch (error) {
          Logger.debug(`Could not resolve definition for: ${functionName}`);
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
}
