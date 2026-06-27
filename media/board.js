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
  let openColumnId = null;

  const root = /** @type {HTMLElement} */ (document.getElementById('board'));

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'state') {
      board = message.board;
      if (openCardId && !findCardRecord(openCardId)) {
        openCardId = null;
      }
      if (openColumnId && !findColumn(openColumnId)) {
        openColumnId = null;
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
    for (const [columnIndex, column] of board.columns.entries()) {
      columns.appendChild(renderColumn(column, columnIndex));
    }
    root.appendChild(columns);

    if (openCardId) {
      const record = findCardRecord(openCardId);
      if (record) {
        root.appendChild(renderCardDetails(record));
        return;
      }
    }

    if (openColumnId) {
      const column = findColumn(openColumnId);
      if (column) {
        root.appendChild(renderColumnDetails(column));
      }
    }
  }

  function renderIntro() {
    const intro = document.createElement('section');
    intro.className = 'board-intro';

    const row = document.createElement('div');
    row.className = 'board-intro-row';

    const copy = document.createElement('div');
    copy.className = 'board-intro-copy';

    const title = document.createElement('h1');
    title.className = 'board-title';
    title.textContent = 'MWNN Kanban';

    const hint = document.createElement('p');
    hint.className = 'board-hint';
    hint.textContent = 'Drag cards between columns, open Details to define slices, and run AI-assigned cards from the board.';

    const addColumn = document.createElement('button');
    addColumn.className = 'board-intro-action';
    addColumn.type = 'button';
    addColumn.textContent = '+ Add column';
    addColumn.addEventListener('click', () => {
      post({ type: 'requestAddColumn' });
    });

    copy.append(title, hint);
    row.append(copy, addColumn);
    intro.appendChild(row);
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
  function renderColumn(column, columnIndex) {
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
    const aside = document.createElement('div');
    aside.className = 'column-header-aside';
    aside.append(renderColumnMetrics(column), renderColumnActions(column));

    header.append(titleGroup, aside);
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
      post({ type: 'requestAddCard', columnId: column.id });
    });
    el.appendChild(add);

    return el;
  }

  function renderColumnActions(column) {
    const actions = document.createElement('div');
    actions.className = 'column-header-actions';

    const configure = document.createElement('button');
    configure.className = 'column-action';
    configure.type = 'button';
    configure.textContent = 'Column';
    configure.title = `Edit ${column.title}`;
    configure.setAttribute('aria-label', `Edit ${column.title}`);
    configure.addEventListener('click', () => {
      openColumnDetails(column.id);
    });

    actions.append(configure);
    return actions;
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
    openColumnId = null;
    openCardId = cardId;
    render();
  }

  function closeCardDetails() {
    openCardId = null;
    render();
  }

  function openColumnDetails(columnId) {
    openCardId = null;
    openColumnId = columnId;
    render();
  }

  function closeColumnDetails() {
    openColumnId = null;
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

  function renderColumnDetails(column) {
    const backdrop = document.createElement('div');
    backdrop.className = 'card-modal-backdrop';
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) {
        closeColumnDetails();
      }
    });

    const dialog = document.createElement('section');
    dialog.className = 'card-modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', `${column.title} column details`);

    const header = document.createElement('div');
    header.className = 'card-modal-header';

    const titleBlock = document.createElement('div');
    titleBlock.className = 'card-modal-title-block';

    const title = document.createElement('h2');
    title.className = 'card-modal-title';
    title.textContent = column.title;

    const subtitle = document.createElement('p');
    subtitle.className = 'card-modal-subtitle';
    subtitle.textContent = `${column.cards.length} card${column.cards.length === 1 ? '' : 's'} in ${formatColumnRole(column.role).toLowerCase()} flow`;

    titleBlock.append(title, subtitle);

    const close = document.createElement('button');
    close.className = 'card-modal-close';
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', closeColumnDetails);

    header.append(titleBlock, close);

    const form = document.createElement('div');
    form.className = 'card-modal-form';

    const titleInput = renderTextInput('Title', column.title);
    const moveControls = renderColumnMoveControls(column);
    const wipInput = renderLimitInput('WIP limit', column.wipLimit ?? null, 'Leave blank for no maximum.');
    const reverseWipInput = renderLimitInput(
      'Ready reverse-WIP minimum',
      column.reverseWip ?? null,
      'Leave blank for none. Useful on Ready columns.',
    );

    form.append(titleInput.wrapper, moveControls.wrapper, wipInput.wrapper, reverseWipInput.wrapper);

    let deleteTarget;
    if (column.cards.length > 0 && board && board.columns.length > 1) {
      deleteTarget = renderDeleteTargetSelect(column);
      form.appendChild(deleteTarget.wrapper);
    }

    const footer = document.createElement('div');
    footer.className = 'card-modal-footer';

    const deleteButton = document.createElement('button');
    deleteButton.className = 'card-modal-danger';
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete column';
    deleteButton.disabled = !board || board.columns.length <= 1;
    deleteButton.addEventListener('click', () => {
      if (!deleteColumnFromDetails(column, deleteTarget?.select)) {
        return;
      }
      closeColumnDetails();
    });

    const spacer = document.createElement('div');
    spacer.className = 'card-modal-spacer';

    const save = document.createElement('button');
    save.className = 'card-modal-save';
    save.type = 'button';
    save.textContent = 'Save';
    save.addEventListener('click', () => {
      if (!saveColumnDetails(column, {
        title: titleInput.input,
        wipLimit: wipInput.input,
        reverseWip: reverseWipInput.input,
      })) {
        return;
      }
      closeColumnDetails();
    });

    footer.append(deleteButton, spacer, save);
    dialog.append(header, form, footer);
    backdrop.appendChild(dialog);
    return backdrop;
  }

  function createOption(value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }

  function renderLimitInput(labelText, value, helpText) {
    const wrapper = document.createElement('label');
    wrapper.className = 'card-field';

    const label = document.createElement('span');
    label.className = 'card-field-label';
    label.textContent = labelText;

    const input = document.createElement('input');
    input.className = 'card-field-input';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.value = formatLimitValue(value);

    const help = document.createElement('span');
    help.className = 'card-field-help';
    help.textContent = helpText;

    wrapper.append(label, input, help);
    return { wrapper, input };
  }

  function renderColumnMoveControls(column) {
    const wrapper = document.createElement('div');
    wrapper.className = 'card-field';

    const label = document.createElement('span');
    label.className = 'card-field-label';
    label.textContent = 'Position';

    const columnIndex = board ? board.columns.findIndex((candidate) => candidate.id === column.id) : -1;
    const columnCount = board ? board.columns.length : 0;

    const row = document.createElement('div');
    row.className = 'column-move-row';

    const moveLeft = document.createElement('button');
    moveLeft.className = 'column-action';
    moveLeft.type = 'button';
    moveLeft.textContent = '← Move left';
    moveLeft.title = `Move ${column.title} left`;
    moveLeft.setAttribute('aria-label', `Move ${column.title} left`);
    moveLeft.disabled = columnIndex <= 0;
    moveLeft.addEventListener('click', () => {
      post({ type: 'reorderColumn', columnId: column.id, toIndex: columnIndex - 1 });
    });

    const moveRight = document.createElement('button');
    moveRight.className = 'column-action';
    moveRight.type = 'button';
    moveRight.textContent = 'Move right →';
    moveRight.title = `Move ${column.title} right`;
    moveRight.setAttribute('aria-label', `Move ${column.title} right`);
    moveRight.disabled = columnIndex < 0 || columnIndex >= columnCount - 1;
    moveRight.addEventListener('click', () => {
      post({ type: 'reorderColumn', columnId: column.id, toIndex: columnIndex + 1 });
    });

    row.append(moveLeft, moveRight);

    const help = document.createElement('span');
    help.className = 'card-field-help';
    help.textContent = columnCount > 0
      ? `Column ${columnIndex + 1} of ${columnCount}.`
      : 'Reorder this column relative to the others.';

    wrapper.append(label, row, help);
    return { wrapper };
  }

  function renderDeleteTargetSelect(column) {
    const wrapper = document.createElement('label');
    wrapper.className = 'card-field';

    const label = document.createElement('span');
    label.className = 'card-field-label';
    label.textContent = 'Move existing cards to';

    const select = document.createElement('select');
    select.className = 'card-field-select';

    if (board) {
      for (const candidate of board.columns) {
        if (candidate.id === column.id) {
          continue;
        }
        select.appendChild(createOption(candidate.id, candidate.title));
      }
    }

    const help = document.createElement('span');
    help.className = 'card-field-help';
    help.textContent = 'Required before deleting a populated column.';

    wrapper.append(label, select, help);
    return { wrapper, select };
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

  function saveColumnDetails(column, fields) {
    const nextTitle = normalizeText(fields.title.value);
    if (nextTitle.length > 0 && nextTitle !== column.title) {
      post({ type: 'renameColumn', columnId: column.id, title: nextTitle });
    }

    const nextWipLimit = parseLimitValue(fields.wipLimit.value);
    const nextReverseWip = parseLimitValue(fields.reverseWip.value);
    if (!nextWipLimit.valid || !nextReverseWip.valid) {
      window.alert('Column limits must be non-negative whole numbers, or blank for none.');
      return false;
    }

    if (nextWipLimit.value !== (column.wipLimit ?? null) || nextReverseWip.value !== (column.reverseWip ?? null)) {
      post({
        type: 'setColumnLimits',
        columnId: column.id,
        wipLimit: nextWipLimit.value,
        reverseWip: nextReverseWip.value,
      });
    }

    return true;
  }

  function deleteColumnFromDetails(column, targetSelect) {
    if (!board || board.columns.length <= 1) {
      window.alert('The board must keep at least one column.');
      return false;
    }

    if (column.cards.length > 0 && !targetSelect) {
      window.alert('Choose another column to receive the existing cards before deleting this one.');
      return false;
    }

    if (!window.confirm(`Delete column "${column.title}"?`)) {
      return false;
    }

    if (column.cards.length > 0 && targetSelect) {
      post({
        type: 'deleteColumn',
        columnId: column.id,
        targetColumnId: targetSelect.value,
      });
      return true;
    }

    post({ type: 'deleteColumn', columnId: column.id });
    return true;
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

  function findColumn(columnId) {
    if (!board) {
      return null;
    }

    return board.columns.find((column) => column.id === columnId) ?? null;
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

  function formatLimitValue(value) {
    return typeof value === 'number' ? String(value) : '';
  }

  function parseLimitValue(value) {
    const normalized = normalizeText(value);
    if (normalized.length === 0) {
      return { valid: true, value: null };
    }

    const parsed = Number(normalized);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return { valid: false, value: null };
    }

    return { valid: true, value: parsed };
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
