// @ts-check
// Webview UI for MWNN Kanban. Plain browser JS - no Node or vscode imports.
// Mirrors the message protocol declared in src/types.ts.
(function () {
  const vscode = acquireVsCodeApi();

  /**
   * @typedef {{ kind: 'human' | 'ai', name?: string }} Assignee
   * @typedef {{
   *   id: string,
   *   title: string,
   *   createdAt: number,
   *   updatedAt?: number,
   *   description?: string,
   *   acceptanceCriteria?: string,
   *   activity?: string,
   *   assignee?: Assignee
   * }} Card
   * @typedef {{
   *   id: string,
   *   title: string,
   *   role?: 'backlog' | 'ready' | 'in-progress' | 'done' | 'custom',
   *   wipLimit?: number | null,
   *   reverseWip?: number | null,
   *   cards: Card[]
   * }} Column
   */

  /** @type {{ version: number, columns: Column[] } | null} */
  let board = null;
  let draggedCardId = null;
  let openCardId = null;

  const root = /** @type {HTMLElement} */ (document.getElementById('board'));

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'state') {
      board = message.board;
      if (openCardId && !findCardRecord(openCardId)) {
        openCardId = null;
      }
      render();
    }
  });

  function render() {
    root.innerHTML = '';
    root.appendChild(renderIntro());
    if (!board) {
      root.appendChild(renderLoadingState());
      return;
    }

    const columns = document.createElement('div');
    columns.className = 'board-columns';
    for (const column of board.columns) {
      columns.appendChild(renderColumn(column));
    }
    root.appendChild(columns);

    if (openCardId) {
      const record = findCardRecord(openCardId);
      if (record) {
        root.appendChild(renderCardDetails(record));
      }
    }
  }

  function renderIntro() {
    const intro = document.createElement('section');
    intro.className = 'board-intro';

    const title = document.createElement('h1');
    title.className = 'board-title';
    title.textContent = 'MWNN Kanban';

    const hint = document.createElement('p');
    hint.className = 'board-hint';
    hint.textContent = 'Drag cards between columns, open Details to define slices, and run AI-assigned cards from the board.';

    intro.append(title, hint);
    return intro;
  }

  function renderLoadingState() {
    const loading = document.createElement('div');
    loading.className = 'board-empty';
    loading.textContent = 'Loading board state...';
    return loading;
  }

  /**
   * @param {Column} column
   */
  function renderColumn(column) {
    const el = document.createElement('section');
    el.className = 'column';
    el.setAttribute('aria-label', column.title);

    const header = document.createElement('div');
    header.className = 'column-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'column-heading';

    const title = document.createElement('h2');
    title.className = 'column-title';
    title.textContent = column.title;

    const role = document.createElement('span');
    role.className = 'column-role';
    role.textContent = formatColumnRole(column.role);

    titleGroup.append(title, role);
    header.append(titleGroup, renderColumnMetrics(column));
    el.appendChild(header);

    const cards = document.createElement('div');
    cards.className = 'cards';
    cards.dataset.columnId = column.id;
    cards.setAttribute('role', 'list');
    cards.setAttribute('aria-label', `${column.title} cards`);
    for (const card of column.cards) {
      cards.appendChild(renderCard(card));
    }
    if (column.cards.length === 0) {
      cards.appendChild(renderColumnEmptyState());
    }
    wireDropTarget(cards, column.id);
    el.appendChild(cards);

    const add = document.createElement('button');
    add.className = 'add-card';
    add.type = 'button';
    add.textContent = '+ Add card';
    add.setAttribute('aria-label', `Add a card to ${column.title}`);
    add.addEventListener('click', () => {
      const text = window.prompt('Card title');
      if (text && text.trim()) {
        post({ type: 'addCard', columnId: column.id, title: text.trim() });
      }
    });
    el.appendChild(add);

    return el;
  }

  function renderColumnMetrics(column) {
    const metrics = document.createElement('div');
    metrics.className = 'column-metrics';

    const count = document.createElement('span');
    count.className = 'column-count';
    count.textContent = `${column.cards.length} card${column.cards.length === 1 ? '' : 's'}`;
    metrics.appendChild(count);

    if (typeof column.wipLimit === 'number') {
      const wip = document.createElement('span');
      wip.className = `column-badge${column.cards.length > column.wipLimit ? ' column-badge-warning' : ''}`;
      wip.textContent = `WIP ${column.cards.length}/${column.wipLimit}`;
      metrics.appendChild(wip);
    }

    if (column.role === 'ready' && typeof column.reverseWip === 'number') {
      const defined = column.cards.filter((card) => normalizeText(card.description).length > 0).length;
      const ready = document.createElement('span');
      ready.className = `column-badge${defined < column.reverseWip ? ' column-badge-warning' : ''}`;
      ready.textContent = `Defined ${defined}/${column.reverseWip}`;
      metrics.appendChild(ready);
    }

    return metrics;
  }

  function renderColumnEmptyState() {
    const empty = document.createElement('p');
    empty.className = 'column-empty';
    empty.textContent = 'No cards yet. Add one to get started.';
    return empty;
  }

  /**
   * @param {Card} card
   */
  function renderCard(card) {
    const el = document.createElement('article');
    el.className = 'card';
    el.draggable = true;
    el.dataset.cardId = card.id;
    el.setAttribute('role', 'listitem');
    el.setAttribute('aria-label', card.title);

    const body = document.createElement('div');
    body.className = 'card-body';

    const label = document.createElement('span');
    label.className = 'card-title';
    label.textContent = card.title;
    label.addEventListener('dblclick', () => {
      openCardDetails(card.id);
    });

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.append(renderAssigneeBadge(card.assignee));
    if (normalizeText(card.description).length === 0) {
      meta.appendChild(renderChip('Needs definition', 'card-chip-warning'));
    }

    body.append(label, meta);

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const details = document.createElement('button');
    details.className = 'card-action';
    details.type = 'button';
    details.textContent = 'Details';
    details.title = 'Open card details';
    details.setAttribute('aria-label', `Open details for ${card.title}`);
    details.addEventListener('click', () => {
      openCardDetails(card.id);
    });

    const del = document.createElement('button');
    del.className = 'card-delete';
    del.type = 'button';
    del.textContent = 'Delete';
    del.title = 'Delete card';
    del.setAttribute('aria-label', `Delete ${card.title}`);
    del.addEventListener('click', () => {
      post({ type: 'deleteCard', cardId: card.id });
    });

    actions.append(details, del);
    el.append(body, actions);

    el.addEventListener('dragstart', () => {
      draggedCardId = card.id;
      el.classList.add('dragging');
      el.setAttribute('aria-grabbed', 'true');
    });
    el.addEventListener('dragend', () => {
      draggedCardId = null;
      el.classList.remove('dragging');
      el.removeAttribute('aria-grabbed');
    });

    return el;
  }

  /**
   * @param {Assignee | undefined} assignee
   */
  function renderAssigneeBadge(assignee) {
    if (!assignee) {
      return renderChip('Unassigned', 'card-chip-muted');
    }

    const label = assignee.name ? `${assignee.kind === 'ai' ? 'AI' : 'Human'}: ${assignee.name}` : assignee.kind === 'ai' ? 'AI' : 'Human';
    return renderChip(label, assignee.kind === 'ai' ? 'card-chip-ai' : 'card-chip-human');
  }

  /**
   * @param {string} text
   * @param {string} className
   */
  function renderChip(text, className) {
    const chip = document.createElement('span');
    chip.className = `card-chip ${className}`;
    chip.textContent = text;
    return chip;
  }

  function openCardDetails(cardId) {
    openCardId = cardId;
    render();
  }

  function closeCardDetails() {
    openCardId = null;
    render();
  }

  /**
   * @param {{ column: Column, card: Card }} record
   */
  function renderCardDetails(record) {
    const backdrop = document.createElement('div');
    backdrop.className = 'card-modal-backdrop';
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) {
        closeCardDetails();
      }
    });

    const dialog = document.createElement('section');
    dialog.className = 'card-modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', `${record.card.title} details`);

    const header = document.createElement('div');
    header.className = 'card-modal-header';

    const titleBlock = document.createElement('div');
    titleBlock.className = 'card-modal-title-block';

    const title = document.createElement('h2');
    title.className = 'card-modal-title';
    title.textContent = record.card.title;

    const subtitle = document.createElement('p');
    subtitle.className = 'card-modal-subtitle';
    subtitle.textContent = `Currently in ${record.column.title}`;

    titleBlock.append(title, subtitle);

    const close = document.createElement('button');
    close.className = 'card-modal-close';
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', closeCardDetails);

    header.append(titleBlock, close);

    const form = document.createElement('div');
    form.className = 'card-modal-form';

    const titleInput = renderTextInput('Title', record.card.title);
    const descriptionInput = renderTextArea('Description', record.card.description ?? '', 6);
    const acceptanceInput = renderTextArea('Acceptance criteria', record.card.acceptanceCriteria ?? '', 5);
    const assigneeControls = renderAssigneeControls(record.card.assignee);
    const activityView = renderActivity(record.card.activity);

    form.append(
      titleInput.wrapper,
      assigneeControls.wrapper,
      descriptionInput.wrapper,
      acceptanceInput.wrapper,
      activityView,
    );

    const footer = document.createElement('div');
    footer.className = 'card-modal-footer';

    if (record.card.assignee?.kind === 'ai') {
      const runAi = document.createElement('button');
      runAi.className = 'card-modal-ai';
      runAi.type = 'button';
      runAi.textContent = 'Run with AI';
      runAi.addEventListener('click', () => {
        post({ type: 'runCardWithAI', cardId: record.card.id });
      });
      footer.appendChild(runAi);
    }

    const spacer = document.createElement('div');
    spacer.className = 'card-modal-spacer';

    const save = document.createElement('button');
    save.className = 'card-modal-save';
    save.type = 'button';
    save.textContent = 'Save';
    save.addEventListener('click', () => {
      saveCardDetails(record.card, {
        title: titleInput.input,
        description: descriptionInput.input,
        acceptanceCriteria: acceptanceInput.input,
        assigneeKind: assigneeControls.kind,
        assigneeName: assigneeControls.name,
      });
      closeCardDetails();
    });

    footer.append(spacer, save);
    dialog.append(header, form, footer);
    backdrop.appendChild(dialog);
    return backdrop;
  }

  function renderTextInput(labelText, value) {
    const wrapper = document.createElement('label');
    wrapper.className = 'card-field';

    const label = document.createElement('span');
    label.className = 'card-field-label';
    label.textContent = labelText;

    const input = document.createElement('input');
    input.className = 'card-field-input';
    input.type = 'text';
    input.value = value;

    wrapper.append(label, input);
    return { wrapper, input };
  }

  function renderTextArea(labelText, value, rows) {
    const wrapper = document.createElement('label');
    wrapper.className = 'card-field';

    const label = document.createElement('span');
    label.className = 'card-field-label';
    label.textContent = labelText;

    const input = document.createElement('textarea');
    input.className = 'card-field-textarea';
    input.rows = rows;
    input.value = value;

    wrapper.append(label, input);
    return { wrapper, input };
  }

  /**
   * @param {Assignee | undefined} assignee
   */
  function renderAssigneeControls(assignee) {
    const wrapper = document.createElement('div');
    wrapper.className = 'card-field';

    const label = document.createElement('span');
    label.className = 'card-field-label';
    label.textContent = 'Assignee';

    const row = document.createElement('div');
    row.className = 'card-assignee-row';

    const kind = document.createElement('select');
    kind.className = 'card-field-select';
    kind.append(
      createOption('unassigned', 'Unassigned'),
      createOption('human', 'Human'),
      createOption('ai', 'AI'),
    );
    kind.value = assignee?.kind ?? 'unassigned';

    const name = document.createElement('input');
    name.className = 'card-field-input';
    name.type = 'text';
    name.value = assignee?.name ?? '';

    const syncNameVisibility = () => {
      const hidden = kind.value === 'unassigned';
      name.hidden = hidden;
      name.placeholder = kind.value === 'ai' ? 'AI name (optional)' : 'Human name (optional)';
    };
    syncNameVisibility();
    kind.addEventListener('change', syncNameVisibility);

    row.append(kind, name);
    wrapper.append(label, row);
    return { wrapper, kind, name };
  }

  function renderActivity(activity) {
    const wrapper = document.createElement('section');
    wrapper.className = 'card-activity';

    const label = document.createElement('h3');
    label.className = 'card-field-label';
    label.textContent = 'Activity';

    const body = document.createElement('pre');
    body.className = 'card-activity-body';
    body.textContent = activity ?? 'No activity yet.';

    wrapper.append(label, body);
    return wrapper;
  }

  function createOption(value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }

  function saveCardDetails(card, fields) {
    const nextTitle = normalizeText(fields.title.value);
    if (nextTitle.length > 0 && nextTitle !== card.title) {
      post({ type: 'editCard', cardId: card.id, title: nextTitle });
    }

    const nextDescription = normalizeText(fields.description.value);
    if (nextDescription !== normalizeText(card.description)) {
      post({ type: 'setDescription', cardId: card.id, description: nextDescription });
    }

    const nextAcceptanceCriteria = normalizeText(fields.acceptanceCriteria.value);
    if (nextAcceptanceCriteria !== normalizeText(card.acceptanceCriteria)) {
      post({
        type: 'setAcceptanceCriteria',
        cardId: card.id,
        acceptanceCriteria: nextAcceptanceCriteria,
      });
    }

    const nextAssignee = readAssignee(fields.assigneeKind, fields.assigneeName);
    if (!assigneesEqual(card.assignee, nextAssignee)) {
      post(nextAssignee
        ? { type: 'setAssignee', cardId: card.id, assignee: nextAssignee }
        : { type: 'setAssignee', cardId: card.id });
    }
  }

  function readAssignee(kindField, nameField) {
    if (kindField.value === 'unassigned') {
      return undefined;
    }

    const name = normalizeText(nameField.value);
    return name.length > 0 ? { kind: kindField.value, name } : { kind: kindField.value };
  }

  function assigneesEqual(left, right) {
    if (!left && !right) {
      return true;
    }
    if (!left || !right) {
      return false;
    }
    return left.kind === right.kind && (left.name ?? '') === (right.name ?? '');
  }

  function findCardRecord(cardId) {
    if (!board) {
      return null;
    }

    for (const column of board.columns) {
      const card = column.cards.find((candidate) => candidate.id === cardId);
      if (card) {
        return { column, card };
      }
    }
    return null;
  }

  function formatColumnRole(role) {
    switch (role) {
      case 'backlog':
        return 'Backlog';
      case 'ready':
        return 'Ready';
      case 'in-progress':
        return 'In progress';
      case 'done':
        return 'Done';
      default:
        return 'Custom';
    }
  }

  function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function wireDropTarget(cards, columnId) {
    cards.addEventListener('dragover', (event) => {
      event.preventDefault();
      cards.classList.add('drag-over');
    });
    cards.addEventListener('dragleave', () => {
      cards.classList.remove('drag-over');
    });
    cards.addEventListener('drop', (event) => {
      event.preventDefault();
      cards.classList.remove('drag-over');
      if (!draggedCardId) {
        return;
      }
      const toIndex = indexFromDropEvent(cards, event);
      post({ type: 'moveCard', cardId: draggedCardId, toColumnId: columnId, toIndex });
    });
  }

  function indexFromDropEvent(cards, event) {
    const siblings = [...cards.querySelectorAll('.card:not(.dragging)')];
    const y = /** @type {DragEvent} */ (event).clientY;
    let index = siblings.length;
    for (let i = 0; i < siblings.length; i += 1) {
      const rect = siblings[i].getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    return index;
  }

  function post(message) {
    vscode.postMessage(message);
  }

  render();
  post({ type: 'ready' });
})();
