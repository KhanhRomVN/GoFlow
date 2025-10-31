import * as vscode from "vscode";
import * as path from "path";
import { FlowManager, FlowItem } from "../managers/FlowManager";

export type FlowTreeElement = FlowTreeItem | CreateFlowTreeItem;

export class FlowTreeDataProvider
  implements vscode.TreeDataProvider<FlowTreeElement>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    FlowTreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private flowManager: FlowManager;

  constructor(flowManager: FlowManager) {
    this.flowManager = flowManager;
    this.flowManager.onDidChangeFlows(() => {
      this.refresh();
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FlowTreeElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: FlowTreeElement): Thenable<FlowTreeElement[]> {
    if (!element) {
      const flows = this.flowManager.getFlows();
      const items: FlowTreeElement[] = flows.map(
        (flow) => new FlowTreeItem(flow, vscode.TreeItemCollapsibleState.None)
      );

      items.push(new CreateFlowTreeItem());

      return Promise.resolve(items);
    }

    return Promise.resolve([]);
  }
}

export class FlowTreeItem extends vscode.TreeItem {
  constructor(
    public readonly flow: FlowItem,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(flow.name, collapsibleState);

    this.tooltip = this.getTooltip();
    this.description = this.getDescription();
    this.iconPath = this.getIcon();
    this.contextValue = "flowItem";
    this.command = {
      command: "goflow.openFlow",
      title: "Open Flow",
      arguments: [this.flow],
    };
  }

  private getTooltip(): string {
    const fileName = path.basename(this.flow.file);
    return `${this.flow.type}: ${this.flow.name}\nFile: ${fileName}\nLine: ${this.flow.line}`;
  }

  private getDescription(): string {
    const fileName = path.basename(this.flow.file);
    return `${this.flow.type} • ${fileName}:${this.flow.line}`;
  }

  private getIcon(): vscode.ThemeIcon {
    const iconMap: Record<FlowItem["type"], string> = {
      function: "symbol-function",
      method: "symbol-method",
      struct: "symbol-struct",
      interface: "symbol-interface",
    };

    return new vscode.ThemeIcon(
      iconMap[this.flow.type] || "symbol-misc",
      new vscode.ThemeColor("charts.blue")
    );
  }
}

export class CreateFlowTreeItem extends vscode.TreeItem {
  constructor() {
    super("Create New Flow", vscode.TreeItemCollapsibleState.None);

    this.tooltip = "Create a new flow from current file";
    this.iconPath = new vscode.ThemeIcon(
      "add",
      new vscode.ThemeColor("charts.green")
    );
    this.contextValue = "createFlow";
    this.command = {
      command: "goflow.createFlow",
      title: "Create Flow",
    };
  }
}
