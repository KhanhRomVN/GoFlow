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
          case "ready":
            const config = vscode.workspace.getConfiguration("goflow");
            this.panel.webview.postMessage({
              command: "renderGraph",
              data: this.graphData,
              config: {
                enableJumpToFile: config.get("enableJumpToFile", true),
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
      Logger.error("Failed to jump to definition", error);
      vscode.window.showErrorMessage("Failed to open file");
    }
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
  <script src="${vsUri}/editor/editor.main.nls.js"></script>
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
