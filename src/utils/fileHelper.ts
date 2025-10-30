import * as vscode from "vscode";
import * as path from "path";
import { Logger } from "./logger";

export class FileHelper {
  static async findGoFiles(
    workspaceFolder: vscode.WorkspaceFolder
  ): Promise<vscode.Uri[]> {
    try {
      const pattern = new vscode.RelativePattern(workspaceFolder, "**/*.go");
      const excludePattern = "**/vendor/**";

      const files = await vscode.workspace.findFiles(pattern, excludePattern);

      Logger.info(`Found ${files.length} Go files in workspace`);
      return files;
    } catch (error) {
      Logger.error("Failed to find Go files", error);
      return [];
    }
  }

  static async readFile(uri: vscode.Uri): Promise<string> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      return document.getText();
    } catch (error) {
      Logger.error(`Failed to read file: ${uri.fsPath}`, error);
      throw error;
    }
  }

  static async writeFile(uri: vscode.Uri, content: string): Promise<void> {
    try {
      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
      Logger.info(`File written: ${uri.fsPath}`);
    } catch (error) {
      Logger.error(`Failed to write file: ${uri.fsPath}`, error);
      throw error;
    }
  }

  static async fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  static getRelativePath(
    uri: vscode.Uri,
    workspaceFolder: vscode.WorkspaceFolder
  ): string {
    return path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
  }

  static getFileName(uri: vscode.Uri): string {
    return path.basename(uri.fsPath);
  }

  static getFileNameWithoutExtension(uri: vscode.Uri): string {
    const fileName = this.getFileName(uri);
    return fileName.replace(/\.[^/.]+$/, "");
  }

  static getWorkspaceFolder(
    uri: vscode.Uri
  ): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.getWorkspaceFolder(uri);
  }

  static async ensureDirectoryExists(dirUri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(dirUri);
    } catch (error) {
      Logger.error(`Failed to create directory: ${dirUri.fsPath}`, error);
      throw error;
    }
  }

  static async deleteFile(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.delete(uri);
      Logger.info(`File deleted: ${uri.fsPath}`);
    } catch (error) {
      Logger.error(`Failed to delete file: ${uri.fsPath}`, error);
      throw error;
    }
  }

  static async copyFile(source: vscode.Uri, target: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.copy(source, target, { overwrite: true });
      Logger.info(`File copied: ${source.fsPath} -> ${target.fsPath}`);
    } catch (error) {
      Logger.error(`Failed to copy file: ${source.fsPath}`, error);
      throw error;
    }
  }

  static isGoFile(uri: vscode.Uri): boolean {
    return uri.fsPath.endsWith(".go");
  }

  static async getFileStats(
    uri: vscode.Uri
  ): Promise<vscode.FileStat | undefined> {
    try {
      return await vscode.workspace.fs.stat(uri);
    } catch (error) {
      Logger.error(`Failed to get file stats: ${uri.fsPath}`, error);
      return undefined;
    }
  }

  static async findGoModRoot(
    startUri: vscode.Uri
  ): Promise<vscode.Uri | undefined> {
    let currentDir = path.dirname(startUri.fsPath);

    while (currentDir !== path.dirname(currentDir)) {
      const goModPath = vscode.Uri.file(path.join(currentDir, "go.mod"));

      if (await this.fileExists(goModPath)) {
        return vscode.Uri.file(currentDir);
      }

      currentDir = path.dirname(currentDir);
    }

    return undefined;
  }

  static async getPackageName(uri: vscode.Uri): Promise<string | undefined> {
    try {
      const content = await this.readFile(uri);
      const packageMatch = content.match(/^package\s+(\w+)/m);

      if (packageMatch) {
        return packageMatch[1];
      }

      return undefined;
    } catch (error) {
      Logger.error(`Failed to get package name: ${uri.fsPath}`, error);
      return undefined;
    }
  }

  static async findGoFilesInPackage(
    packageUri: vscode.Uri
  ): Promise<vscode.Uri[]> {
    try {
      const dirPath = path.dirname(packageUri.fsPath);
      const files = await vscode.workspace.fs.readDirectory(
        vscode.Uri.file(dirPath)
      );

      const goFiles = files
        .filter(
          ([name, type]) =>
            type === vscode.FileType.File && name.endsWith(".go")
        )
        .map(([name]) => vscode.Uri.file(path.join(dirPath, name)));

      return goFiles;
    } catch (error) {
      Logger.error(
        `Failed to find Go files in package: ${packageUri.fsPath}`,
        error
      );
      return [];
    }
  }
}
