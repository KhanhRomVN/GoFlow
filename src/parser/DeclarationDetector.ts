import * as vscode from "vscode";
import { Logger } from "../utils/logger";

export interface DeclarationUsage {
  declarationSymbol: vscode.DocumentSymbol;
  usageCount: number;
}

export class DeclarationDetector {
  /**
   * Extract receiver type from Go method signature
   */
  extractReceiverType(functionName: string): string | null {
    const methodPattern = /^\((\*?)([A-Z][a-zA-Z0-9_]*)\)\./;
    const match = functionName.match(methodPattern);
    return match ? match[2] : null;
  }

  /**
   * Find declaration usages in a function
   */
  async findDeclarationUsages(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol,
    declarationSymbols: vscode.DocumentSymbol[]
  ): Promise<DeclarationUsage[]> {
    const receiverType = this.extractReceiverType(symbol.name);
    const usages = new Map<
      string,
      {
        symbol: vscode.DocumentSymbol;
        count: number;
        document: vscode.TextDocument;
      }
    >();

    const text = document.getText(symbol.range);
    const lines = text.split("\n");
    const typeUsageRegex = /\b([A-Z][a-zA-Z0-9_]*)\b/g;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      let match;

      while ((match = typeUsageRegex.exec(line)) !== null) {
        const typeName = match[1];
        const charIndex = match.index;

        // Skip receiver type
        if (receiverType && typeName === receiverType) continue;

        // Skip field assignments
        const afterMatch = line.substring(charIndex + typeName.length).trim();
        if (afterMatch.startsWith(":")) continue;

        const beforeMatch = line.substring(0, charIndex).trim();
        if (beforeMatch === "" || /^[\s\t]*$/.test(beforeMatch)) {
          if (afterMatch.startsWith(":")) continue;
        }

        const absoluteLine = symbol.range.start.line + lineIndex;
        const position = new vscode.Position(absoluteLine, charIndex);

        try {
          const definitions = await vscode.commands.executeCommand<
            vscode.Location[]
          >("vscode.executeDefinitionProvider", document.uri, position);

          if (definitions && definitions.length > 0) {
            const def = definitions[0];
            const defFilePath = def.uri.fsPath;

            // Skip stdlib and vendor
            if (this.isExternalDependency(defFilePath)) continue;

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

              if (targetSymbol && this.isDeclaration(targetSymbol)) {
                const key = `${targetSymbol.kind}_${targetSymbol.name}`;
                if (!usages.has(key)) {
                  usages.set(key, {
                    symbol: targetSymbol,
                    count: 0,
                    document: defDocument,
                  });
                }
                usages.get(key)!.count++;
              }
            }
          }
        } catch (error) {
          Logger.error(
            `[findDeclarationUsages] ERROR resolving "${typeName}":`,
            error
          );
        }
      }
    }

    return Array.from(usages.values()).map((usage) => ({
      declarationSymbol: usage.symbol,
      usageCount: usage.count,
    }));
  }

  private isExternalDependency(filePath: string): boolean {
    return (
      filePath.includes("/usr/local/go/") ||
      filePath.includes("/go/pkg/mod/") ||
      filePath.includes("\\go\\pkg\\mod\\") ||
      filePath.includes("/vendor/") ||
      !filePath.endsWith(".go")
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
}
