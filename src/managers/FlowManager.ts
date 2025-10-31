import * as vscode from "vscode";
import { Logger } from "../utils/logger";

export interface FlowItem {
  id: string;
  name: string;
  type: "function" | "method" | "struct" | "interface";
  file: string;
  line: number;
  createdAt: number;
}

export class FlowManager {
  private static instance: FlowManager;
  private context: vscode.ExtensionContext;
  private flows: FlowItem[] = [];
  private onDidChangeFlowsEmitter = new vscode.EventEmitter<void>();

  public readonly onDidChangeFlows = this.onDidChangeFlowsEmitter.event;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadFlows();
  }

  public static initialize(context: vscode.ExtensionContext): FlowManager {
    if (!FlowManager.instance) {
      FlowManager.instance = new FlowManager(context);
    }
    return FlowManager.instance;
  }

  public static getInstance(): FlowManager {
    if (!FlowManager.instance) {
      throw new Error("FlowManager not initialized");
    }
    return FlowManager.instance;
  }

  private loadFlows(): void {
    try {
      const workspaceState = this.context.workspaceState;
      const savedFlows = workspaceState.get<FlowItem[]>("goflow.flows", []);
      this.flows = savedFlows;
    } catch (error) {
      Logger.error("Failed to load flows", error);
      this.flows = [];
    }
  }

  private async saveFlows(): Promise<void> {
    try {
      await this.context.workspaceState.update("goflow.flows", this.flows);
      this.onDidChangeFlowsEmitter.fire();
    } catch (error) {
      Logger.error("Failed to save flows", error);
      throw error;
    }
  }

  public async addFlow(
    flow: Omit<FlowItem, "id" | "createdAt">
  ): Promise<FlowItem> {
    const newFlow: FlowItem = {
      ...flow,
      id: `${flow.type}_${flow.name}_${Date.now()}`,
      createdAt: Date.now(),
    };

    const existingIndex = this.flows.findIndex(
      (f) =>
        f.name === flow.name && f.file === flow.file && f.type === flow.type
    );

    if (existingIndex !== -1) {
      this.flows[existingIndex] = newFlow;
    } else {
      this.flows.push(newFlow);
    }

    await this.saveFlows();
    return newFlow;
  }

  public async deleteFlow(flowId: string): Promise<void> {
    const index = this.flows.findIndex((f) => f.id === flowId);
    if (index !== -1) {
      const deletedFlow = this.flows.splice(index, 1)[0];
      await this.saveFlows();
    }
  }

  public async clearAllFlows(): Promise<void> {
    this.flows = [];
    await this.saveFlows();
  }

  public getFlows(): FlowItem[] {
    return [...this.flows];
  }

  public getFlowById(id: string): FlowItem | undefined {
    return this.flows.find((f) => f.id === id);
  }

  public async updateFlow(
    flowId: string,
    updates: Partial<FlowItem>
  ): Promise<void> {
    const flow = this.flows.find((f) => f.id === flowId);
    if (flow) {
      Object.assign(flow, updates);
      await this.saveFlows();
    }
  }
}
