import * as vscode from "vscode";
import { GraphData } from "../models/Node";
import { Logger } from "../utils/logger";

export class WebviewPanel {
  private static currentPanel: WebviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private graphData: GraphData;
  private document: vscode.TextDocument;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    graphData: GraphData,
    document: vscode.TextDocument
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.graphData = graphData;
    this.document = document;

    this.panel.webview.html = this.getWebviewContent();

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "jumpToDefinition":
            await this.jumpToDefinition(message.file, message.line);
            break;
          case "getCodePreview":
            await this.sendCodePreview(
              message.file,
              message.line,
              message.nodeId
            );
            break;
          case "saveCode":
            await this.handleSaveCode(
              message.file,
              message.startLine,
              message.endLine,
              message.code,
              message.nodeId
            );
            break;
          case "resolveDefinitionAtLine":
            await this.handleResolveDefinition(
              message.file,
              message.line,
              message.relativeLine,
              message.lineContent,
              message.nodeId,
              message.shouldTracePath
            );
            break;
          case "ready":
            const config = vscode.workspace.getConfiguration("goflow");

            // Get VSCode theme colors
            const isDark =
              vscode.window.activeColorTheme.kind ===
                vscode.ColorThemeKind.Dark ||
              vscode.window.activeColorTheme.kind ===
                vscode.ColorThemeKind.HighContrast;

            this.panel.webview.postMessage({
              command: "renderGraph",
              data: this.graphData,
              config: {
                enableJumpToFile: config.get("enableJumpToFile", true),
              },
              theme: {
                isDark: isDark,
                kind: vscode.window.activeColorTheme.kind,
              },
            });
            break;
          case "export":
            await this.handleExport(message.dataUrl);
            break;
        }
      },
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public static render(
    extensionUri: vscode.Uri,
    graphData: GraphData,
    document: vscode.TextDocument
  ) {
    const column = vscode.ViewColumn.Two;

    if (WebviewPanel.currentPanel) {
      WebviewPanel.currentPanel.graphData = graphData;
      WebviewPanel.currentPanel.document = document;
      WebviewPanel.currentPanel.panel.reveal(column);
      WebviewPanel.currentPanel.panel.webview.postMessage({
        command: "renderGraph",
        data: graphData,
      });
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "goflowCanvas",
      "GoFlow Canvas",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      }
    );

    WebviewPanel.currentPanel = new WebviewPanel(
      panel,
      extensionUri,
      graphData,
      document
    );
  }

  public static refresh() {
    if (WebviewPanel.currentPanel) {
      WebviewPanel.currentPanel.panel.webview.postMessage({
        command: "refresh",
      });
    }
  }

  public static exportDiagram() {
    if (WebviewPanel.currentPanel) {
      WebviewPanel.currentPanel.panel.webview.postMessage({
        command: "exportRequest",
      });
    }
  }

  public static isVisible(): boolean {
    return WebviewPanel.currentPanel !== undefined;
  }

  public static dispose() {
    if (WebviewPanel.currentPanel) {
      WebviewPanel.currentPanel.panel.dispose();
      WebviewPanel.currentPanel = undefined;
    }
  }

  private async jumpToDefinition(file: string, line: number) {
    try {
      const uri = vscode.Uri.file(file);
      const document = await vscode.workspace.openTextDocument(uri);

      const editor = await vscode.window.showTextDocument(
        document,
        vscode.ViewColumn.One
      );

      const position = new vscode.Position(line - 1, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
      );
    } catch (error) {
      Logger.error("[WebviewPanel] Failed to jump to definition", error);
      vscode.window.showErrorMessage("Failed to open file");
    }
  }

  private async handleSaveCode(
    file: string,
    startLine: number,
    endLine: number,
    newCode: string,
    nodeId: string
  ) {
    try {
      const uri = vscode.Uri.file(file);
      const document = await vscode.workspace.openTextDocument(uri);

      // Validate line range
      if (startLine < 1 || endLine > document.lineCount) {
        const errorMsg = `Invalid line range: ${startLine}-${endLine} (document has ${document.lineCount} lines)`;
        Logger.error(`[WebviewPanel] ${errorMsg}`);
        vscode.window.showErrorMessage(errorMsg);
        this.panel.webview.postMessage({
          command: "codeUpdateFailed",
          nodeId: nodeId,
          error: errorMsg,
        });
        return;
      }

      const edit = new vscode.WorkspaceEdit();

      // Convert to 0-based line numbers
      const range = new vscode.Range(
        new vscode.Position(startLine - 1, 0),
        new vscode.Position(
          endLine - 1,
          document.lineAt(endLine - 1).text.length
        )
      );

      edit.replace(uri, range, newCode);

      const success = await vscode.workspace.applyEdit(edit);

      if (success) {
        // Save the document
        await document.save();

        vscode.window.showInformationMessage(
          `Code updated successfully in ${file}`
        );

        this.panel.webview.postMessage({
          command: "codeSaved",
          nodeId: nodeId,
        });

        // Update graph data with new code
        const nodeIndex = this.graphData.nodes.findIndex(
          (n) => n.id === nodeId
        );
        if (nodeIndex !== -1) {
          this.graphData.nodes[nodeIndex].code = newCode;
        }
      } else {
        const errorMsg = "Failed to apply code changes";
        Logger.error(`[WebviewPanel] ${errorMsg}`);
        vscode.window.showErrorMessage(errorMsg);
        this.panel.webview.postMessage({
          command: "codeUpdateFailed",
          nodeId: nodeId,
          error: errorMsg,
        });
      }
    } catch (error) {
      const errorMsg = `Failed to save code: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
      Logger.error(`[WebviewPanel] ${errorMsg}`, error);
      vscode.window.showErrorMessage(errorMsg);
      this.panel.webview.postMessage({
        command: "codeUpdateFailed",
        nodeId: nodeId,
        error: errorMsg,
      });
    }
  }

  private async handleResolveDefinition(
    file: string,
    startLine: number,
    relativeLine: number,
    lineContent: string,
    sourceNodeId: string,
    shouldTracePath: boolean = false
  ) {
    try {
      const uri = vscode.Uri.file(file);

      const absoluteLine = startLine + relativeLine - 2;

      // Parse line để tìm function calls
      const functionCallRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
      let match;
      const functionCalls: Array<{ name: string; index: number }> = [];

      while ((match = functionCallRegex.exec(lineContent)) !== null) {
        const functionName = match[1];
        const keywords = [
          "if",
          "for",
          "switch",
          "return",
          "defer",
          "go",
          "select",
          "case",
          "range",
        ];

        if (!keywords.includes(functionName)) {
          functionCalls.push({
            name: functionName,
            index: match.index,
          });
        }
      }

      // Thử resolve definition cho từng function call
      for (const call of functionCalls) {
        const position = new vscode.Position(absoluteLine, call.index);

        try {
          const definitions = await vscode.commands.executeCommand<
            vscode.Location[]
          >("vscode.executeDefinitionProvider", uri, position);

          if (definitions && definitions.length > 0) {
            const def = definitions[0];
            const defFilePath = def.uri.fsPath;

            // Bỏ qua stdlib và vendor
            if (
              defFilePath.includes("/usr/local/go/") ||
              defFilePath.includes("/go/pkg/mod/") ||
              defFilePath.includes("\\go\\pkg\\mod\\") ||
              defFilePath.includes("/vendor/") ||
              !defFilePath.endsWith(".go")
            ) {
              continue;
            }

            // Lấy symbol tại definition
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

                // Gửi message về webview để highlight edge
                this.panel.webview.postMessage({
                  command: "highlightEdge",
                  sourceNodeId: sourceNodeId,
                  targetNodeId: targetId,
                });

                if (shouldTracePath) {
                  this.panel.webview.postMessage({
                    command: "tracePathForLineClick",
                    targetNodeId: targetId,
                  });
                }

                return;
              }
            }
          }
        } catch (error) {
          Logger.error(
            `[WebviewPanel] Failed to resolve definition for ${call.name}`,
            error
          );
        }
      }

      // Nếu không tìm thấy definition nào, clear highlight
      Logger.warn(`[WebviewPanel] No valid definition found`);
      this.panel.webview.postMessage({
        command: "clearHighlight",
      });
    } catch (error) {
      Logger.error(
        "[WebviewPanel] Failed to resolve definition at line",
        error
      );
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

  private isFunctionOrMethod(symbol: vscode.DocumentSymbol): boolean {
    return (
      symbol.kind === vscode.SymbolKind.Function ||
      symbol.kind === vscode.SymbolKind.Method
    );
  }

  private getNodeType(kind: vscode.SymbolKind): "function" | "method" {
    return kind === vscode.SymbolKind.Function ? "function" : "method";
  }

  private async sendCodePreview(file: string, line: number, nodeId: string) {
    try {
      const uri = vscode.Uri.file(file);
      const document = await vscode.workspace.openTextDocument(uri);

      const startLine = Math.max(0, line - 1);
      const endLine = Math.min(document.lineCount - 1, line + 10);

      const range = new vscode.Range(
        new vscode.Position(startLine, 0),
        new vscode.Position(endLine, 0)
      );

      const codeSnippet = document.getText(range);

      this.panel.webview.postMessage({
        command: "showCodePreview",
        nodeId: nodeId,
        code: codeSnippet,
        language: "go",
      });
    } catch (error) {
      Logger.error("Failed to get code preview", error);
    }
  }

  private async handleExport(dataUrl: string) {
    const defaultUri = vscode.Uri.file(
      `${this.document.fileName.replace(".go", "")}-goflow.png`
    );

    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: {
        Images: ["png"],
      },
    });

    if (uri) {
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      await vscode.workspace.fs.writeFile(uri, buffer);
      vscode.window.showInformationMessage(`Diagram exported to ${uri.fsPath}`);
    }
  }

  private getWebviewContent(): string {
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "webview.js")
    );
    const stylesUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "flow-canvas.css")
    );

    const mediaUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media")
    );

    const vsUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "vs")
    );

    const editorWorkerUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "media",
        "vs",
        "base",
        "worker",
        "workerMain.js"
      )
    );

    const languageWorkerUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "media",
        "vs",
        "language",
        "go",
        "goWorker.js"
      )
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; font-src ${this.panel.webview.cspSource} data:; script-src ${this.panel.webview.cspSource} 'unsafe-inline' 'unsafe-eval'; img-src ${this.panel.webview.cspSource} data: blob:; worker-src ${this.panel.webview.cspSource} blob:;">
  <title>GoFlow Canvas</title>
  <link href="${stylesUri}" rel="stylesheet">
  <script>
    var require = {
      paths: {
        'vs': '${vsUri}'
      }
    };
    window.MonacoEnvironment = {
      getWorkerUrl: function (moduleId, label) {
        return '${editorWorkerUri}';
      },
      baseUrl: '${vsUri}'
    };
  </script>
  <script src="${vsUri}/loader.js"></script>
  <script src="${vsUri}/editor/editor.main.js"></script>
</head>
<body>
  <div id="root"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose() {
    WebviewPanel.currentPanel = undefined;
    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
