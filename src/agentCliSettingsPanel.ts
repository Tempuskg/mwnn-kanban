import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { AGENT_CLI_LABELS, AGENT_CLI_THINKING_FLAGS } from './agentCliHandoff';
import { AGENT_CLI_PROVIDER_IDS } from './agentCliProviders';
import { BUNDLED_AGENT_CLI_MODELS, BUNDLED_AGENT_CLI_THINKING_LEVELS } from './agentCliDiscovery';
import { AGENT_CLI_PANEL_SETTINGS, createAgentCliSettingsPanelController } from './agentCliSettingsPanelController';

/** Register before the no-workspace activation exit: User settings always work. */
export function registerAgentCliSettingsPanel(context: vscode.ExtensionContext): void {
  let panel: vscode.WebviewPanel | undefined;
  context.subscriptions.push(vscode.commands.registerCommand('mwnn-kanban.openAgentCliModels', () => {
    if (panel) {
      panel.reveal();
      return;
    }
    const opened = vscode.window.createWebviewPanel(
      'mwnn-kanban.agentCliModels', 'Agent CLI Models', vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist'), vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );
    panel = opened;
    let ready = false;
    const disposables: vscode.Disposable[] = [];
    const configuration = (): vscode.WorkspaceConfiguration =>
      vscode.workspace.getConfiguration('mwnn-kanban', vscode.workspace.workspaceFolders?.[0]?.uri);
    const controller = createAgentCliSettingsPanelController({
      workspaceAvailable: () => (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
      inspect: (key) => configuration().inspect<unknown>(key),
      update: (key, value, scope) => configuration().update(
        key, value, scope === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global,
      ),
      post: (state) => {
        if (ready) {
          void opened.webview.postMessage(state);
        }
      },
      suggestions: AGENT_CLI_PROVIDER_IDS.map((id) => ({
        id, label: AGENT_CLI_LABELS[id],
        suggestedModels: BUNDLED_AGENT_CLI_MODELS[id],
        suggestedThinkingLevels: BUNDLED_AGENT_CLI_THINKING_LEVELS[id],
        thinkingApplied: AGENT_CLI_THINKING_FLAGS[id] !== undefined,
      })),
    });
    opened.webview.onDidReceiveMessage((message: unknown) => {
      ready = true;
      void controller.handle(message).catch((cause: unknown) => {
        void vscode.window.showErrorMessage(`Agent CLI Models: ${String(cause)}`);
      });
    }, null, disposables);
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (AGENT_CLI_PANEL_SETTINGS.some((key) => event.affectsConfiguration(`mwnn-kanban.${key}`))) {
        controller.refresh();
      }
    }, null, disposables);
    vscode.workspace.onDidChangeWorkspaceFolders(() => controller.refresh(), null, disposables);
    opened.onDidDispose(() => {
      panel = undefined;
      for (const disposable of disposables) {
        disposable.dispose();
      }
    });
    context.subscriptions.push(opened);
    const webview = opened.webview;
    const nonce = randomBytes(16).toString('hex');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'agentCliModels.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'agent-cli-models.css'));
    webview.html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}"><title>Agent CLI Models</title>
</head><body><main id="settings">Loading Agent CLI Models…</main>
<script nonce="${nonce}" src="${script}"></script></body></html>`;
  }));
}
