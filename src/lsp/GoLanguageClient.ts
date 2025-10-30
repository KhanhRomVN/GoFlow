import * as vscode from "vscode";
import * as path from "path";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";
import { Logger } from "../utils/logger";

export class GoLanguageClient {
  private client: LanguageClient | undefined;
  private isReady: boolean = false;

  async start(context: vscode.ExtensionContext): Promise<void> {
    try {
      const goplsPath = await this.findGopls();

      if (!goplsPath) {
        Logger.info("gopls not found, LSP features will be limited");
        return;
      }

      const serverOptions: ServerOptions = {
        command: goplsPath,
        args: ["-mode=stdio"],
      };

      const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: "file", language: "go" }],
        synchronize: {
          fileEvents: vscode.workspace.createFileSystemWatcher("**/*.go"),
        },
      };

      this.client = new LanguageClient(
        "goflow-gopls",
        "GoFlow Language Server",
        serverOptions,
        clientOptions
      );

      await this.client.start();
      this.isReady = true;
      Logger.info("Go Language Server started successfully");
    } catch (error) {
      Logger.error("Failed to start Go Language Server", error);
      vscode.window.showWarningMessage(
        "GoFlow: Could not start Go Language Server. Some features may be limited."
      );
    }
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.stop();
      this.isReady = false;
      Logger.info("Go Language Server stopped");
    }
  }

  async getReferences(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location[] | undefined> {
    if (!this.isReady) {
      return undefined;
    }

    try {
      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeReferenceProvider",
        document.uri,
        position
      );

      return locations;
    } catch (error) {
      Logger.error("Failed to get references", error);
      return undefined;
    }
  }

  async getDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location[] | undefined> {
    if (!this.isReady) {
      return undefined;
    }

    try {
      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeDefinitionProvider",
        document.uri,
        position
      );

      return locations;
    } catch (error) {
      Logger.error("Failed to get definition", error);
      return undefined;
    }
  }

  async getImplementations(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location[] | undefined> {
    if (!this.isReady) {
      return undefined;
    }

    try {
      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeImplementationProvider",
        document.uri,
        position
      );

      return locations;
    } catch (error) {
      Logger.error("Failed to get implementations", error);
      return undefined;
    }
  }

  async getCallHierarchy(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CallHierarchyItem[] | undefined> {
    if (!this.isReady) {
      return undefined;
    }

    try {
      const items = await vscode.commands.executeCommand<
        vscode.CallHierarchyItem[]
      >("vscode.prepareCallHierarchy", document.uri, position);

      return items;
    } catch (error) {
      Logger.error("Failed to get call hierarchy", error);
      return undefined;
    }
  }

  private async findGopls(): Promise<string | undefined> {
    const goConfig = vscode.workspace.getConfiguration("go");
    const alternateTools = goConfig.get<{ [key: string]: string }>(
      "alternateTools"
    );

    if (alternateTools && alternateTools["gopls"]) {
      return alternateTools["gopls"];
    }

    const goplsPath = await this.findExecutable("gopls");
    return goplsPath;
  }

  private async findExecutable(name: string): Promise<string | undefined> {
    try {
      const { exec } = require("child_process");
      const command =
        process.platform === "win32" ? `where ${name}` : `which ${name}`;

      return new Promise((resolve) => {
        exec(command, (error: any, stdout: string) => {
          if (error) {
            resolve(undefined);
          } else {
            resolve(stdout.trim().split("\n")[0]);
          }
        });
      });
    } catch (error) {
      Logger.error(`Failed to find executable: ${name}`, error);
      return undefined;
    }
  }

  isClientReady(): boolean {
    return this.isReady;
  }
}
