import * as vscode from "vscode";
import { GraphData } from "../models/Node";
import { Logger } from "../utils/logger";

export class CanvasPanel {
  private static currentPanel: CanvasPanel | undefined;
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
            this.panel.webview.postMessage({
              command: "renderGraph",
              data: this.graphData,
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

    if (CanvasPanel.currentPanel) {
      CanvasPanel.currentPanel.graphData = graphData;
      CanvasPanel.currentPanel.document = document;
      CanvasPanel.currentPanel.panel.reveal(column);
      CanvasPanel.currentPanel.panel.webview.postMessage({
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

    CanvasPanel.currentPanel = new CanvasPanel(
      panel,
      extensionUri,
      graphData,
      document
    );
  }

  public static refresh() {
    if (CanvasPanel.currentPanel) {
      CanvasPanel.currentPanel.panel.webview.postMessage({
        command: "refresh",
      });
    }
  }

  public static exportDiagram() {
    if (CanvasPanel.currentPanel) {
      CanvasPanel.currentPanel.panel.webview.postMessage({
        command: "exportRequest",
      });
    }
  }

  public static isVisible(): boolean {
    return CanvasPanel.currentPanel !== undefined;
  }

  public static dispose() {
    if (CanvasPanel.currentPanel) {
      CanvasPanel.currentPanel.panel.dispose();
      CanvasPanel.currentPanel = undefined;
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

      Logger.debug(`Jumped to ${file}:${line}`);
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
      vscode.Uri.joinPath(this.extensionUri, "media", "main.js")
    );
    const stylesUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "styles.css")
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src ${this.panel.webview.cspSource} https://cdnjs.cloudflare.com https://cdn.jsdelivr.net 'unsafe-inline' 'unsafe-eval'; img-src ${this.panel.webview.cspSource} data:;">
  <title>GoFlow Canvas</title>
  <link href="${stylesUri}" rel="stylesheet">
</head>
<body>
  <div id="loading" style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 20px;">
    Loading GoFlow Canvas...
  </div>
  <div id="canvas" style="display: none;"></div>
  <div id="tooltip" class="tooltip"></div>
  <div id="controls">
    <button id="fit-btn" title="Fit to screen">⊡</button>
    <button id="zoom-in-btn" title="Zoom in">+</button>
    <button id="zoom-out-btn" title="Zoom out">−</button>
    <button id="export-btn" title="Export as PNG">💾</button>
    <select id="layout-select">
      <option value="dagre">Dagre</option>
      <option value="cose">COSE</option>
      <option value="circle">Circle</option>
      <option value="grid">Grid</option>
    </select>
  </div>
  
  <script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.26.0/cytoscape.min.js" 
          onerror="document.getElementById('loading').innerHTML='Failed to load Cytoscape. Check internet connection.'">
  </script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/dagre/0.8.5/dagre.min.js"
          onerror="console.error('Failed to load dagre')">
  </script>
  <script src="https://cdn.jsdelivr.net/npm/cytoscape-dagre@2.5.0/cytoscape-dagre.min.js"
          onerror="console.error('Failed to load cytoscape-dagre')">
  </script>
  <script>
    window.addEventListener('error', function(e) {
      document.getElementById('loading').innerHTML = 'Error: ' + e.message + '<br>Check console for details.';
      console.error('Webview error:', e);
    });
    
    // Check if cytoscape loaded
    if (typeof cytoscape === 'undefined') {
      document.getElementById('loading').innerHTML = 'Cytoscape failed to load. Check console.';
    } else {
      document.getElementById('loading').innerHTML = 'Cytoscape loaded. Initializing...';
      document.getElementById('canvas').style.display = 'block';
    }
  </script>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose() {
    CanvasPanel.currentPanel = undefined;
    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
