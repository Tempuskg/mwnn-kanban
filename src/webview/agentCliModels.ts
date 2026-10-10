/// <reference lib="dom" />
import type {
  AgentCliPanelList,
  AgentCliSettingsPanelMessage,
  AgentCliSettingsPanelProvider,
  AgentCliSettingsPanelState,
  AgentCliSettingsScope,
} from '../types';

declare function acquireVsCodeApi(): { postMessage(message: AgentCliSettingsPanelMessage): void };
const host = acquireVsCodeApi();
const root = document.getElementById('settings');
let renderedScope: AgentCliSettingsScope | undefined;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function send(message: AgentCliSettingsPanelMessage): void {
  host.postMessage(message);
  // A host state (including a rejected edit) unlocks the controls again.
  root?.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select')
    .forEach((control) => { control.disabled = true; });
}

function button(label: string, action: () => void): HTMLButtonElement {
  const node = element('button', label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

function inputField(id: string, label: string, suggestions: readonly string[], value = ''): {
  readonly wrapper: HTMLDivElement;
  readonly input: HTMLInputElement;
} {
  const wrapper = element('div');
  wrapper.className = 'field';
  const caption = element('label', label);
  caption.htmlFor = id;
  const input = element('input');
  input.id = id;
  input.type = 'text';
  input.value = value;
  input.autocomplete = 'off';
  const choices = element('datalist');
  choices.id = `${id}-suggestions`;
  input.setAttribute('list', choices.id);
  for (const name of [...new Set(suggestions)]) {
    const option = element('option');
    option.value = name;
    choices.append(option);
  }
  wrapper.append(caption, input, choices);
  return { wrapper, input };
}

function providerList(provider: AgentCliSettingsPanelProvider, list: AgentCliPanelList, current: AgentCliSettingsPanelState): HTMLElement {
  const models = list === 'models';
  const names = models ? provider.models : provider.thinkingLevels;
  const lower = models ? provider.inheritedModels : provider.inheritedThinkingLevels;
  const suggested = models ? provider.suggestedModels : provider.suggestedThinkingLevels;
  const section = element('div');
  section.className = 'provider-list';
  section.append(element('h3', models ? 'Models' : 'Thinking levels'));
  if (!models && !provider.thinkingApplied) {
    const note = element('p', 'Not applied by this CLI. Cursor runs at its default effort.');
    note.className = 'muted';
    section.append(note);
  }
  const edit = (action: 'add' | 'remove' | 'makeDefault' | 'clear', name: string): void => send({
    type: 'settingsListEdit', scope: current.scope, provider: provider.id, list, action, name,
  });
  if (names.length === 0) {
    section.append(element('p', `No ${models ? 'models' : 'thinking levels'} in this scope.`));
    if (lower.length > 0) {
      const inherited = element('p', `Inherited from ${current.inheritedScope}: ${lower.join(', ')} (first ${models ? 'is the default' : 'is in use'}).`);
      inherited.className = 'inherited';
      section.append(inherited);
    } else {
      section.append(element('p', 'CLI default'));
    }
  } else {
    const entries = element('ol');
    for (const [index, name] of names.entries()) {
      const row = element('li');
      const label = element('span', name);
      label.className = 'entry-name';
      row.append(label);
      if (index === 0) {
        const badge = element('span', models ? 'Default' : 'In use');
        badge.className = 'badge';
        row.append(badge);
      } else {
        const promote = button(models ? 'Make default' : 'Set', () => edit('makeDefault', name));
        promote.setAttribute('aria-label', `${models ? 'Make default model' : 'Set thinking level'} ${name}`);
        row.append(promote);
      }
      const remove = button('Remove', () => edit('remove', name));
      remove.className = 'secondary';
      remove.setAttribute('aria-label', `Remove ${models ? 'model' : 'thinking level'} ${name}`);
      row.append(remove);
      entries.append(row);
    }
    section.append(entries);
  }
  const form = element('form');
  const field = inputField(`${provider.id}-${list}`, models ? 'Add model' : 'Thinking level', [...names, ...suggested]);
  field.input.dataset['draft'] = 'true';
  form.append(field.wrapper, button(models ? 'Add model' : 'Add suggestion', () => edit('add', field.input.value)));
  if (!models) {
    form.append(button('Set level', () => edit('makeDefault', field.input.value)));
    if (names.length > 0) {
      form.append(button('Clear', () => edit('clear', '')));
    }
    const note = element('p', `Clear removes this scope's level; ${lower.length > 0 ? 'inherited settings apply' : 'the CLI default applies'} when no lower scope sets one.`);
    note.className = 'muted';
    form.append(note);
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    edit(models ? 'add' : 'makeDefault', field.input.value);
  });
  const hint = element('p', suggested.length > 0 ? `Bundled suggestions: ${suggested.join(', ')}. You can type any name.` : 'You can type any name.');
  hint.className = 'muted';
  section.append(form, hint);
  return section;
}

function render(current: AgentCliSettingsPanelState): void {
  if (!root) {
    return;
  }
  const drafts = new Map<string, string>();
  if (renderedScope === current.scope) {
    root.querySelectorAll<HTMLInputElement>('input[data-draft]').forEach((input) => drafts.set(input.id, input.value));
  }
  renderedScope = current.scope;
  const focus = document.activeElement?.id;
  root.replaceChildren();
  root.append(element('h1', 'Agent CLI Models'));
  const scopeRow = element('div');
  scopeRow.className = 'scope-row';
  const caption = element('label', 'Settings scope');
  caption.htmlFor = 'scope';
  const select = element('select');
  select.id = 'scope';
  const scopes: AgentCliSettingsScope[] = current.workspaceAvailable ? ['workspace', 'user'] : ['user'];
  for (const scope of scopes) {
    const option = element('option', scope === 'workspace' ? 'Workspace' : 'User');
    option.value = scope;
    option.selected = current.scope === scope;
    select.append(option);
  }
  select.addEventListener('change', () => send({ type: 'settingsScope', scope: select.value === 'workspace' ? 'workspace' : 'user' }));
  scopeRow.append(caption, select, element('span', 'Edits are saved only to this scope. Inherited values are read-only.'));
  root.append(scopeRow);
  if (current.error) {
    const error = element('p', current.error);
    error.className = 'error';
    error.setAttribute('role', 'alert');
    root.append(error);
  }
  const providers = element('div');
  providers.className = 'providers';
  for (const provider of current.providers) {
    const section = element('section');
    section.className = 'provider';
    section.append(element('h2', provider.label), providerList(provider, 'models', current), providerList(provider, 'thinkingLevels', current));
    providers.append(section);
  }
  root.append(providers);
  const stages = element('section');
  stages.className = 'stages';
  stages.append(element('h2', 'AI loop stage overrides'), element('p', 'Each stage has independent overrides for each CLI. Remove an override to use inherited stage settings, then that CLI’s default. Legacy shared values remain active until edited.'));
  for (const stage of current.stages) {
    const row = element('section');
    row.className = 'stage';
    const provider = current.providers.find((entry) => entry.id === stage.provider);
    row.append(element('h3', stage.id.charAt(0).toUpperCase() + stage.id.slice(1) + ' · ' + (provider?.label ?? stage.provider)));
    if (provider?.thinkingApplied === false) {
      row.append(element('p', 'Thinking level is not applied by this CLI; it runs at its default effort.'));
    }
    for (const list of ['models', 'thinkingLevels'] as const) {
      const models = list === 'models';
      const own = models ? stage.model : stage.thinkingLevel;
      const inherited = models ? stage.inheritedModel : stage.inheritedThinkingLevel;
      const suggestions = models ? stage.suggestedModels : stage.suggestedThinkingLevels;
      const field = inputField(`${stage.id}-${stage.provider}-${list}`, models ? 'Model override' : 'Thinking override', suggestions, own ?? '');
      const form = element('form');
      const edit = (action: 'set' | 'remove'): void => send({
        type: 'settingsStageEdit', scope: current.scope, stage: stage.id, provider: stage.provider, list, action, name: field.input.value,
      });
      form.append(field.wrapper, button('Save', () => edit('set')));
      if (own !== null) {
        form.append(button('Remove override', () => edit('remove')));
      } else {
        const note = element('p', inherited !== null ? `Inherited from ${current.inheritedScope}: ${inherited}` : 'Uses provider default');
        note.className = 'inherited';
        form.append(note);
      }
      form.addEventListener('submit', (event) => { event.preventDefault(); edit('set'); });
      row.append(form);
    }
    stages.append(row);
  }
  root.append(stages);
  root.querySelectorAll<HTMLInputElement>('input[data-draft]').forEach((input) => {
    input.value = drafts.get(input.id) ?? '';
  });
  if (current.error) {
    const error = root.querySelector<HTMLElement>('[role="alert"]');
    if (error) {
      error.tabIndex = -1;
      error.focus();
    }
  } else if (focus) {
    document.getElementById(focus)?.focus();
  }
}

window.addEventListener('message', (event: MessageEvent<AgentCliSettingsPanelState>) => {
  if (event.origin === 'null' || event.origin !== window.location.origin || event.data?.type !== 'settingsState') {
    return;
  }
  render(event.data);
});
host.postMessage({ type: 'settingsReady' });
