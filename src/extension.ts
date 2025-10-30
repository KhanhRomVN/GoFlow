import * as vscode from "vscode";
import { CanvasPanel } from "./webview/CanvasPanel";
import { GoParser } from "./parser/GoParser";
import { Logger, LogLevel } from "./utils/logger";

export function activate(context: vscode.ExtensionContext) {
  Logger.initialize(LogLevel.DEBUG);
  Logger.info("GoFlow extension activating...");

  const goParser = new GoParser();

  const showCanvasCommand = vscode.commands.registerCommand(
    "goflow.showCanvas",
    async () => {
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        vscode.window.showErrorMessage("No active editor");
        return;
      }

      if (editor.document.languageId !== "go") {
        vscode.window.showErrorMessage("GoFlow only works with Go files");
        return;
      }

      try {
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Analyzing Go code...",
            cancellable: false,
          },
          async (progress) => {
            progress.report({ increment: 0 });

            const graphData = await goParser.parseFile(editor.document);

            progress.report({ increment: 50 });

            CanvasPanel.render(
              context.extensionUri,
              graphData,
              editor.document
            );

            progress.report({ increment: 100 });
          }
        );

        Logger.info(`Canvas opened for: ${editor.document.fileName}`);
      } catch (error) {
        Logger.error("Failed to show canvas", error);
        vscode.window.showErrorMessage(
          `Failed to show GoFlow canvas: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }
  );

  const refreshCanvasCommand = vscode.commands.registerCommand(
    "goflow.refreshCanvas",
    () => {
      CanvasPanel.refresh();
    }
  );

  const exportDiagramCommand = vscode.commands.registerCommand(
    "goflow.exportDiagram",
    () => {
      CanvasPanel.exportDiagram();
    }
  );

  context.subscriptions.push(
    showCanvasCommand,
    refreshCanvasCommand,
    exportDiagramCommand
  );

  const config = vscode.workspace.getConfiguration("goflow");
  if (config.get("autoRefresh")) {
    const autoRefresh = vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.languageId === "go" && CanvasPanel.isVisible()) {
        vscode.commands.executeCommand("goflow.refreshCanvas");
      }
    });
    context.subscriptions.push(autoRefresh);
  }

  Logger.info("GoFlow extension activated successfully");
}

export function deactivate() {
  CanvasPanel.dispose();
  Logger.dispose();
}
