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
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Analyzing Go code...",
            cancellable: false,
          },
          async (progress) => {
            progress.report({ increment: 0, message: "Loading functions..." });

            // Step 1: Lấy danh sách functions từ file hiện tại
            const functions = await getFunctionsFromDocument(editor.document);

            if (functions.length === 0) {
              vscode.window.showWarningMessage(
                "No functions found in current file"
              );
              return;
            }

            progress.report({ increment: 20 });

            // Step 2: Cho phép user chọn function làm root
            const selectedFunction = await vscode.window.showQuickPick(
              functions.map((fn) => ({
                label: `${fn.type === "function" ? "𝑓" : "ⓜ"} ${fn.name}`,
                description: `Line ${fn.line} • ${fn.type}`,
                detail: fn.signature,
                value: fn,
              })),
              {
                placeHolder:
                  "Select a function to analyze (will show all dependencies)",
              }
            );

            if (!selectedFunction) {
              return;
            }

            progress.report({
              increment: 40,
              message: `Analyzing dependencies of ${selectedFunction.value.name}...`,
            });

            // Step 3: Parse function và tất cả dependencies
            const graphData = await goParser.parseFunctionWithDependencies(
              editor.document,
              selectedFunction.value
            );

            if (!graphData || graphData.nodes.length === 0) {
              vscode.window.showWarningMessage(
                `No dependencies found for function ${selectedFunction.value.name}`
              );
              return;
            }

            progress.report({ increment: 80, message: "Rendering canvas..." });

            CanvasPanel.render(
              context.extensionUri,
              graphData,
              editor.document
            );

            progress.report({ increment: 100 });

            vscode.window.showInformationMessage(
              `GoFlow: Analyzed ${graphData.nodes.length} nodes and ${graphData.edges.length} edges for function ${selectedFunction.value.name}`
            );
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

async function findPackageFiles(
  document: vscode.TextDocument
): Promise<vscode.TextDocument[]> {
  const files = [document];
  const currentDir = vscode.Uri.joinPath(document.uri, "..");

  try {
    const dirFiles = await vscode.workspace.fs.readDirectory(currentDir);

    for (const [name, type] of dirFiles) {
      if (
        type === vscode.FileType.File &&
        name.endsWith(".go") &&
        !name.endsWith("_test.go")
      ) {
        const fileUri = vscode.Uri.joinPath(currentDir, name);
        if (fileUri.fsPath !== document.uri.fsPath) {
          try {
            const doc = await vscode.workspace.openTextDocument(fileUri);
            files.push(doc);
            Logger.debug(`Added package file: ${name}`);
          } catch (error) {
            Logger.debug(`Could not open file: ${name}`);
          }
        }
      }
    }
  } catch (error) {
    Logger.error("Failed to read package directory", error);
  }

  Logger.info(`Found ${files.length} files in package`);
  return files;
}

async function findWorkspaceFiles(
  document: vscode.TextDocument
): Promise<vscode.TextDocument[]> {
  const files = [document];
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

  if (!workspaceFolder) {
    Logger.warn("No workspace folder found, using current file only");
    return files;
  }

  try {
    const pattern = new vscode.RelativePattern(workspaceFolder, "**/*.go");
    const goFiles = await vscode.workspace.findFiles(
      pattern,
      "**/vendor/**",
      50
    );

    Logger.info(`Found ${goFiles.length} Go files in workspace`);

    for (const uri of goFiles) {
      if (
        uri.fsPath !== document.uri.fsPath &&
        !uri.fsPath.includes("_test.go")
      ) {
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          files.push(doc);
        } catch (error) {
          Logger.debug(`Could not open workspace file: ${uri.fsPath}`);
        }
      }
    }
  } catch (error) {
    Logger.error("Failed to find workspace files", error);
  }

  Logger.info(`Total ${files.length} files selected for analysis`);
  return files;
}

interface FunctionInfo {
  name: string;
  type: "function" | "method";
  line: number;
  signature: string;
  symbol: vscode.DocumentSymbol;
}

async function getFunctionsFromDocument(
  document: vscode.TextDocument
): Promise<FunctionInfo[]> {
  const functions: FunctionInfo[] = [];

  try {
    const symbols = await vscode.commands.executeCommand<
      vscode.DocumentSymbol[]
    >("vscode.executeDocumentSymbolProvider", document.uri);

    if (!symbols) {
      return functions;
    }

    for (const symbol of symbols) {
      if (
        symbol.kind === vscode.SymbolKind.Function ||
        symbol.kind === vscode.SymbolKind.Method
      ) {
        const type =
          symbol.kind === vscode.SymbolKind.Function ? "function" : "method";
        const signature = document
          .getText(symbol.range)
          .split("\n")[0]
          .trim()
          .substring(0, 80);

        functions.push({
          name: symbol.name,
          type,
          line: symbol.range.start.line + 1,
          signature,
          symbol,
        });
      }
    }
  } catch (error) {
    Logger.error("Failed to get functions from document", error);
  }

  return functions;
}
