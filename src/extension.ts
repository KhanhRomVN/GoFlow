import * as vscode from "vscode";
import { WebviewPanel } from "./webview/WebviewPanel";
import { GoParser } from "./parser/GoParser";
import { Logger, LogLevel } from "./utils/logger";
import { FlowManager } from "./managers/FlowManager";
import { FlowTreeDataProvider } from "./views/FlowTreeDataProvider";

export function activate(context: vscode.ExtensionContext) {
  Logger.initialize(LogLevel.DEBUG);

  const flowManager = FlowManager.initialize(context);
  const goParser = new GoParser();
  const flowTreeProvider = new FlowTreeDataProvider(flowManager);

  const treeView = vscode.window.createTreeView("goflowExplorer", {
    treeDataProvider: flowTreeProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(treeView);

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
            const functions = await getFunctionsFromDocument(editor.document);

            if (functions.length === 0) {
              Logger.warn("[Extension] No functions found in current file");
              vscode.window.showWarningMessage(
                "No functions found in current file"
              );
              return;
            }

            progress.report({ increment: 20 });

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

            WebviewPanel.render(
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
      WebviewPanel.refresh();
    }
  );

  const exportDiagramCommand = vscode.commands.registerCommand(
    "goflow.exportDiagram",
    () => {
      WebviewPanel.exportDiagram();
    }
  );

  const createFlowCommand = vscode.commands.registerCommand(
    "goflow.createFlow",
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
        const functions = await getFunctionsFromDocument(editor.document);

        if (functions.length === 0) {
          vscode.window.showWarningMessage(
            "No functions found in current file"
          );
          return;
        }

        const selectedFunction = await vscode.window.showQuickPick(
          functions.map((fn) => ({
            label: `${fn.type === "function" ? "𝑓" : "ⓜ"} ${fn.name}`,
            description: `Line ${fn.line} • ${fn.type}`,
            detail: fn.signature,
            value: fn,
          })),
          {
            placeHolder: "Select a function to create flow",
          }
        );

        if (!selectedFunction) {
          return;
        }

        await flowManager.addFlow({
          name: selectedFunction.value.name,
          type: selectedFunction.value.type,
          file: editor.document.fileName,
          line: selectedFunction.value.line,
        });

        vscode.window.showInformationMessage(
          `Flow created: ${selectedFunction.value.name}`
        );

        await vscode.commands.executeCommand(
          "goflow.openFlowByName",
          selectedFunction.value.name,
          editor.document
        );
      } catch (error) {
        Logger.error("Failed to create flow", error);
        vscode.window.showErrorMessage(
          `Failed to create flow: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }
  );

  const openFlowCommand = vscode.commands.registerCommand(
    "goflow.openFlow",
    async (flow: any) => {
      try {
        const uri = vscode.Uri.file(flow.file);
        const document = await vscode.workspace.openTextDocument(uri);

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Opening flow: ${flow.name}...`,
            cancellable: false,
          },
          async (progress) => {
            progress.report({ increment: 0 });

            const symbols = await vscode.commands.executeCommand<
              vscode.DocumentSymbol[]
            >("vscode.executeDocumentSymbolProvider", document.uri);

            if (!symbols) {
              vscode.window.showErrorMessage(
                "Could not load symbols from file"
              );
              return;
            }

            const targetSymbol = findSymbolByNameAndLine(
              symbols,
              flow.name,
              flow.line
            );

            if (!targetSymbol) {
              vscode.window.showErrorMessage(
                `Function ${flow.name} not found in file`
              );
              return;
            }

            progress.report({ increment: 50 });

            const graphData = await goParser.parseFunctionWithDependencies(
              document,
              { name: flow.name, symbol: targetSymbol }
            );

            if (!graphData || graphData.nodes.length === 0) {
              vscode.window.showWarningMessage(
                `No dependencies found for function ${flow.name}`
              );
              return;
            }

            progress.report({ increment: 80 });

            WebviewPanel.render(context.extensionUri, graphData, document);

            progress.report({ increment: 100 });

            vscode.window.showInformationMessage(
              `Opened flow: ${flow.name} (${graphData.nodes.length} nodes, ${graphData.edges.length} edges)`
            );
          }
        );
      } catch (error) {
        Logger.error("Failed to open flow", error);
        vscode.window.showErrorMessage(
          `Failed to open flow: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }
  );

  const deleteFlowCommand = vscode.commands.registerCommand(
    "goflow.deleteFlow",
    async (item: any) => {
      const flow = item.flow;
      const answer = await vscode.window.showWarningMessage(
        `Delete flow "${flow.name}"?`,
        { modal: true },
        "Delete"
      );

      if (answer === "Delete") {
        await flowManager.deleteFlow(flow.id);
        vscode.window.showInformationMessage(`Flow deleted: ${flow.name}`);
      }
    }
  );

  const clearAllFlowsCommand = vscode.commands.registerCommand(
    "goflow.clearAllFlows",
    async () => {
      const answer = await vscode.window.showWarningMessage(
        "Clear all flows?",
        { modal: true },
        "Clear All"
      );

      if (answer === "Clear All") {
        await flowManager.clearAllFlows();
        vscode.window.showInformationMessage("All flows cleared");
      }
    }
  );

  context.subscriptions.push(
    showCanvasCommand,
    refreshCanvasCommand,
    exportDiagramCommand,
    createFlowCommand,
    openFlowCommand,
    deleteFlowCommand,
    clearAllFlowsCommand
  );

  const config = vscode.workspace.getConfiguration("goflow");
  if (config.get("autoRefresh")) {
    const autoRefresh = vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.languageId === "go" && WebviewPanel.isVisible()) {
        vscode.commands.executeCommand("goflow.refreshCanvas");
      }
    });
    context.subscriptions.push(autoRefresh);
  }
}

export function deactivate() {
  WebviewPanel.dispose();
  Logger.dispose();
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

function findSymbolByNameAndLine(
  symbols: vscode.DocumentSymbol[],
  name: string,
  line: number
): vscode.DocumentSymbol | undefined {
  for (const symbol of symbols) {
    if (
      symbol.name === name &&
      symbol.range.start.line + 1 === line &&
      (symbol.kind === vscode.SymbolKind.Function ||
        symbol.kind === vscode.SymbolKind.Method)
    ) {
      return symbol;
    }

    if (symbol.children && symbol.children.length > 0) {
      const found = findSymbolByNameAndLine(symbol.children, name, line);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}
