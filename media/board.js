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
   *   assignee?: Assignee,
   *   dependsOn?: string[]
   * }} Card
   * @typedef {{
   *   id: string,
   *   title: string,
   *   role?: 'backlog' | 'ready' | 'in-progress' | 'verify' | 'done' | 'custom',
   *   wipLimit?: number | null,
   *   reverseWip?: number | null,
   *   cards: Card[]
   * }} Column
   */

  /** @type {{ version: number, columns: Column[] } | null} */
  let board = null;
  let enableRunWithAI = true;
  let draggedCardId = null;
  let openCardId = null;
  let openColumnId = null;

  // Board zoom. Scales the rendered columns/cards visually (via the CSS `zoom`
  // property, which reflows so scrollbars and drag hit-testing stay correct)
  // without touching card data or stored positions. Bounds mirror clampZoom in
  // src/boardPanel.ts. The level persists on the extension host, so it is
  // restored on the first state push after the panel is (re)opened.
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2;
  const ZOOM_STEP = 0.1;
  const ZOOM_DEFAULT = 1;
  let zoom = ZOOM_DEFAULT;
  let zoomInitialized = false;

  const root = /** @type {HTMLElement} */ (document.getElementById('board'));

  window.addEventListener('message', (event) => {
    // Only trust messages from the VS Code extension host. Webview content runs
    // in a sandboxed `vscode-webview://` iframe and the host delivers its
    // messages under that same origin scheme, so reject anything else (e.g. a
    // web origin) before acting on the payload (CWE-20).
    if (event.origin && !event.origin.startsWith('vscode-webview://')) {
      return;
    }
    const message = event.data;
    if (message && message.type === 'state') {
      board = message.board;
      enableRunWithAI = message.enableRunWithAI !== false;
      // Adopt the host's persisted zoom on the first state push only; after that
      // the webview owns the zoom and merely persists changes back, so later
      // state pushes never clobber an in-flight local change.
      if (!zoomInitialized) {
        if (typeof message.zoom === 'number') {
          zoom = clampZoom(message.zoom);
        }
        zoomInitialized = true;
      }
      if (openCardId && !findCardRecord(openCardId)) {
        openCardId = null;
      }
      if (openColumnId && !findColumn(openColumnId)) {
        openColumnId = null;
      }
      render();
    } else if (message && message.type === 'openCard') {
      openCardDetails(message.cardId);
    }
  });

  function render() {
    closeAssignPicker();
    const previousColumns = root.querySelector('.board-columns');
    const savedScrollLeft = previousColumns ? previousColumns.scrollLeft : 0;
    const savedScrollTop = previousColumns ? previousColumns.scrollTop : 0;

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
    columns.scrollLeft = savedScrollLeft;
    columns.scrollTop = savedScrollTop;
    applyZoom();

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

    const actions = document.createElement('div');
    actions.className = 'board-intro-actions';
    actions.append(renderZoomControls(), addColumn);

    copy.append(title, hint);
    row.append(copy, actions);
    intro.appendChild(row);
    return intro;
  }

  /**
   * On-screen zoom controls: zoom out, a reset button that also displays the
   * current zoom percentage, and zoom in. Lives outside the scaled board so the
   * controls themselves stay at a constant size.
   */
  function renderZoomControls() {
    const group = document.createElement('div');
    group.className = 'board-zoom';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Board zoom');

    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'board-zoom-button board-zoom-out';
    out.textContent = '−';
    out.title = 'Zoom out (Ctrl/Cmd and -)';
    out.setAttribute('aria-label', 'Zoom out');
    out.addEventListener('click', () => setZoom(zoom - ZOOM_STEP));

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'board-zoom-button board-zoom-percent';
    reset.textContent = formatZoomPercent();
    reset.title = 'Reset zoom to 100% (Ctrl/Cmd and 0)';
    reset.addEventListener('click', () => setZoom(ZOOM_DEFAULT));

    const inc = document.createElement('button');
    inc.type = 'button';
    inc.className = 'board-zoom-button board-zoom-in';
    inc.textContent = '+';
    inc.title = 'Zoom in (Ctrl/Cmd and +)';
    inc.setAttribute('aria-label', 'Zoom in');
    inc.addEventListener('click', () => setZoom(zoom + ZOOM_STEP));

    group.append(out, reset, inc);
    return group;
  }

  function formatZoomPercent() {
    return `${Math.round(zoom * 100)}%`;
  }

  function clampZoom(value) {
    if (typeof value !== 'number' || !isFinite(value)) {
      return ZOOM_DEFAULT;
    }
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
  }

  /**
   * Set the board zoom, clamp it, refresh the DOM, and persist the change to the
   * host. Rounding to whole percent steps avoids floating-point drift as the
   * user nudges the level up and down.
   * @param {number} next
   */
  function setZoom(next) {
    const clamped = clampZoom(Math.round(next * 100) / 100);
    if (clamped === zoom) {
      applyZoom();
      return;
    }
    zoom = clamped;
    applyZoom();
    post({ type: 'setZoom', zoom });
  }

  /**
   * Reflect the current zoom into the live DOM: scale the columns, update the
   * percentage display, and disable the in/out buttons at their limits. Safe to
   * call whether or not the board (and its controls) are currently rendered.
   */
  function applyZoom() {
    const columns = /** @type {HTMLElement | null} */ (root.querySelector('.board-columns'));
    if (columns) {
      // CSS `zoom` (not transform: scale) so the flex layout reflows and the
      // horizontal scrollbar and drag hit-testing track the scaled size.
      columns.style.zoom = String(zoom);
      // Zooming in can make a column taller than the viewport; allow vertical
      // scroll so no card is clipped out of reach. At <=100% the columns still
      // fit, so keep the default (CSS) hidden overflow to avoid a stray bar.
      columns.style.overflowY = zoom > 1 ? 'auto' : '';
    }

    const percent = /** @type {HTMLElement | null} */ (root.querySelector('.board-zoom-percent'));
    if (percent) {
      percent.textContent = formatZoomPercent();
      percent.setAttribute('aria-label', `Current zoom ${Math.round(zoom * 100)} percent. Reset to 100%`);
    }

    const inc = /** @type {HTMLButtonElement | null} */ (root.querySelector('.board-zoom-in'));
    if (inc) {
      inc.disabled = zoom >= ZOOM_MAX - 1e-9;
    }
    const out = /** @type {HTMLButtonElement | null} */ (root.querySelector('.board-zoom-out'));
    if (out) {
      out.disabled = zoom <= ZOOM_MIN + 1e-9;
    }
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

    titleGroup.append(title);
    const aside = document.createElement('div');
    aside.className = 'column-header-aside';
    aside.append(renderColumnMetrics(column), renderColumnActions(column));

    header.append(titleGroup, aside);
    // Dropping on the header pins the card to a fixed end of the column: the top
    // for a normal column, the bottom for a reverse-WIP column (filled toward a
    // minimum and consumed from the front, so new cards belong at the back).
    wireDropTarget(header, column.id, () =>
      typeof column.reverseWip === 'number' ? column.cards.length : 0
    );
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
    wireDropTarget(cards, column.id, (event) => indexFromDropEvent(cards, event));
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
      // A blocked card is not actually ready to be pulled, so it does not count
      // toward the Ready reverse-WIP minimum even when it is otherwise defined.
      const defined = column.cards.filter((card) => isCardDefined(card) && !isCardBlocked(card)).length;
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
    meta.append(renderAssigneeBadge(card));
    if (!isCardDefined(card)) {
      meta.appendChild(renderChip('Needs definition', 'card-chip-warning'));
    }
    const blockedByDependency = isCardBlocked(card);
    const blockedByStatus = hasBlockedStatus(card.activity);
    if (blockedByDependency || blockedByStatus) {
      const blockerCount = countBlockingDependencies(card);
      const chip = renderChip('Blocked', 'card-chip-blocked');
      chip.title = blockedByDependency
        ? `Blocked by ${blockerCount} unfinished ${blockerCount === 1 ? 'dependency' : 'dependencies'}`
        : 'Latest card status is BLOCKED';
      meta.appendChild(chip);
    }

    body.append(label, meta);

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    if (card.assignee?.kind === 'ai' && enableRunWithAI && isCardDefined(card)) {
      const runAi = document.createElement('button');
      runAi.className = 'card-action';
      runAi.type = 'button';
      runAi.appendChild(makeIcon(ICON_RUN_AI));
      runAi.title = 'Run with AI';
      runAi.setAttribute('aria-label', `Run ${card.title} with AI`);
      runAi.draggable = true;
      runAi.addEventListener('dragstart', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      runAi.addEventListener('click', (event) => {
        event.stopPropagation();
        post({ type: 'runCardWithAI', cardId: card.id });
      });
      actions.appendChild(runAi);
    }

    const details = document.createElement('button');
    details.className = 'card-action';
    details.type = 'button';
    details.appendChild(makeIcon(ICON_DETAILS));
    details.title = 'Open card details';
    details.setAttribute('aria-label', `Open details for ${card.title}`);
    details.addEventListener('click', () => {
      openCardDetails(card.id);
    });

    actions.append(details);
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
   * Reads terminal status markers from Activity in order and uses only the
   * newest one. An older BLOCKED report stops affecting the card once a later
   * status has been recorded.
   * @param {string | undefined} activity
   */
  function hasBlockedStatus(activity) {
    const matches = [...(activity ?? '').matchAll(/^\s*STATUS:\s*(.*)$/gim)];
    if (matches.length === 0) {
      return false;
    }

    const lastMatch = matches[matches.length - 1];
    return /^BLOCKED\b/i.test(lastMatch?.[1]?.trim() ?? '');
  }

  /**
   * Renders the assignee chip as an interactive control that opens an inline
   * picker to quickly (re)assign the card to a Human, AI, or Unassigned without
   * opening Details. Works for both unassigned and already-assigned cards.
   * @param {Card} card
   */
  function renderAssigneeBadge(card) {
    const assignee = card.assignee;

    let className;
    let text;
    let label;
    if (!assignee) {
      className = 'card-chip-muted';
      text = 'Unassigned';
      label = 'Assign card';
    } else if (assignee.kind === 'ai') {
      className = 'card-chip-ai';
      text = 'AI';
      label = `Change assignee (currently ${text})`;
    } else {
      className = 'card-chip-human';
      text = assignee.name ? `Human: ${assignee.name}` : 'Human';
      label = `Change assignee (currently ${text})`;
    }

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `card-chip ${className} card-chip-assign`;
    chip.textContent = text;
    chip.title = label;
    chip.setAttribute('aria-label', label);
    chip.setAttribute('aria-haspopup', 'menu');

    // The chip lives inside a draggable card. Make it its own (cancelled) drag
    // source so grabbing it never starts a card drag.
    chip.draggable = true;
    chip.addEventListener('dragstart', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    chip.addEventListener('click', (event) => {
      event.stopPropagation();
      if (activeAssignPicker && activeAssignPicker.anchor === chip) {
        closeAssignPicker();
        return;
      }
      openAssignPicker(card, chip);
    });

    return chip;
  }

  /** @type {{ anchor: HTMLElement, cleanup: () => void } | null} */
  let activeAssignPicker = null;

  function closeAssignPicker() {
    if (activeAssignPicker) {
      activeAssignPicker.cleanup();
      activeAssignPicker = null;
    }
  }

  /**
   * Opens a lightweight inline menu anchored to the chip to (re)assign the card.
   * Offers Human and AI, plus Unassigned when the card is already assigned.
   * Selecting an option sends the existing setAssignee message; choosing the
   * current assignee is a no-op that simply dismisses the picker.
   * @param {Card} card
   * @param {HTMLElement} anchor
   */
  function openAssignPicker(card, anchor) {
    closeAssignPicker();

    const currentKind = card.assignee ? card.assignee.kind : 'none';

    const menu = document.createElement('div');
    menu.className = 'assign-picker';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Assign card to');

    const dismiss = () => {
      closeAssignPicker();
      anchor.focus();
    };

    /**
     * @param {'human' | 'ai' | 'none'} kind
     * @param {string} text
     */
    const makeOption = (kind, text) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'assign-picker-option';
      option.setAttribute('role', 'menuitemradio');
      option.setAttribute('aria-checked', String(kind === currentKind));
      option.textContent = text;
      option.addEventListener('click', (event) => {
        event.stopPropagation();
        if (kind === currentKind) {
          dismiss();
          return;
        }
        post(kind === 'none'
          ? { type: 'setAssignee', cardId: card.id }
          : { type: 'setAssignee', cardId: card.id, assignee: { kind } });
        closeAssignPicker();
      });
      return option;
    };

    const options = [makeOption('human', 'Human'), makeOption('ai', 'AI')];
    if (card.assignee) {
      options.push(makeOption('none', 'Unassigned'));
    }
    menu.append(...options);

    document.body.appendChild(menu);

    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
    menu.style.left = `${rect.left + window.scrollX}px`;

    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        dismiss();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const current = options.indexOf(/** @type {HTMLElement} */ (document.activeElement));
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = (current + delta + options.length) % options.length;
        options[next].focus();
      }
    });

    const onPointerDown = (event) => {
      if (!menu.contains(/** @type {Node} */ (event.target)) && event.target !== anchor) {
        closeAssignPicker();
      }
    };
    const onDocKeydown = (event) => {
      if (event.key === 'Escape') {
        dismiss();
      }
    };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onDocKeydown);

    activeAssignPicker = {
      anchor,
      cleanup() {
        document.removeEventListener('mousedown', onPointerDown, true);
        document.removeEventListener('keydown', onDocKeydown);
        menu.remove();
      },
    };

    const initial = options.find((option) => option.getAttribute('aria-checked') === 'true') ?? options[0];
    initial.focus();
  }

  // Codicon-derived 16x16 glyphs, drawn with the even-odd rule so the outlined
  // shapes (info ring, trash can) read as outlines rather than solid blobs.
  const ICON_DETAILS =
    'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm0 1.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 1.75a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM7.25 7h1.5v4.5h-1.5V7z';
  const ICON_DELETE =
    'M10 3V2a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v1H3v1.5h10V3h-3zM7.5 2.5h1V3h-1v-.5zM4.5 5.5l.6 8.05a1 1 0 0 0 1 .95h3.8a1 1 0 0 0 1-.95l.6-8.05H4.5zm2.25 1.5h1v6h-1V7zm2.5 0h1v6h-1V7z';
  const ICON_RUN_AI =
    'M7.53 1.78a.5.5 0 0 1 .94 0l1.2 3.24a.5.5 0 0 0 .3.3l3.25 1.2a.5.5 0 0 1 0 .94l-3.24 1.2a.5.5 0 0 0-.3.3l-1.2 3.25a.5.5 0 0 1-.94 0l-1.2-3.24a.5.5 0 0 0-.3-.3l-3.25-1.2a.5.5 0 0 1 0-.94l3.24-1.2a.5.5 0 0 0 .3-.3l1.2-3.25zM3 11l.55 1.45L5 13l-1.45.55L3 15l-.55-1.45L1 13l1.45-.55L3 11z';

  function makeIcon(pathData) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('fill-rule', 'evenodd');
    svg.setAttribute('clip-rule', 'evenodd');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
    return svg;
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

    header.append(titleBlock, close);

    const form = document.createElement('div');
    form.className = 'card-modal-form';

    const titleInput = renderTextInput('Title', record.card.title);
    const columnSelector = renderColumnSelectorField(record.column.id);
    const descriptionInput = renderTextArea('Description', record.card.description ?? '', 6);
    const acceptanceInput = renderTextArea('Acceptance criteria', record.card.acceptanceCriteria ?? '', 5);
    const assigneeControls = renderAssigneeControls(record.card.assignee);
    const dependencyControls = renderDependencyControls(record.card);
    const activityView = renderActivity(record.card.activity);

    form.append(
      titleInput.wrapper,
      columnSelector.wrapper,
      assigneeControls.wrapper,
      descriptionInput.wrapper,
      acceptanceInput.wrapper,
      dependencyControls.wrapper,
      activityView,
    );

    const footer = document.createElement('div');
    footer.className = 'card-modal-footer';

    const runAi = document.createElement('button');
    runAi.className = 'card-modal-ai';
    runAi.type = 'button';
    runAi.textContent = 'Run with AI';
    runAi.addEventListener('click', () => {
      post({ type: 'runCardWithAI', cardId: record.card.id });
    });

    const syncRunAiButton = () => {
      const shouldShow = assigneeControls.kind.value === 'ai' && enableRunWithAI && isCardDefined(record.card);
      const isShown = footer.contains(runAi);
      if (shouldShow && !isShown) {
        footer.insertBefore(runAi, footer.firstChild);
      } else if (!shouldShow && isShown) {
        runAi.remove();
      }
    };

    if (!isCardDefined(record.card)) {
      const fillAi = document.createElement('button');
      fillAi.className = 'card-modal-ai';
      fillAi.type = 'button';
      fillAi.textContent = 'Fill in with AI';
      fillAi.title = 'Ask AI to write the Description and Acceptance criteria';
      fillAi.addEventListener('click', () => {
        post({ type: 'fillCardDefinition', cardId: record.card.id });
      });
      footer.appendChild(fillAi);
    }

    const spacer = document.createElement('div');
    spacer.className = 'card-modal-spacer';

    const save = document.createElement('button');
    save.className = 'card-modal-save';
    save.type = 'button';
    save.textContent = 'Save';
    save.addEventListener('click', () => {
      saveCardDetails(record.card, getCardFormFields());
      closeCardDetails();
    });

    const getCardFormFields = () => ({
      title: titleInput.input,
      description: descriptionInput.input,
      acceptanceCriteria: acceptanceInput.input,
      assigneeKind: assigneeControls.kind,
      assigneeName: assigneeControls.name,
      getDependencies: dependencyControls.getDependencies,
      currentColumnId: record.column.id,
      columnSelect: columnSelector.select,
    });

    const requestClose = () => {
      const fields = getCardFormFields();
      if (!cardFormHasChanges(record.card, fields)) {
        closeCardDetails();
        return;
      }

      renderUnsavedChangesPrompt(
        backdrop,
        () => {
          saveCardDetails(record.card, fields);
          closeCardDetails();
        },
        closeCardDetails,
        () => close.focus(),
      );
    };

    close.addEventListener('click', requestClose);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) {
        requestClose();
      }
    });

    const duplicateBtn = document.createElement('button');
    duplicateBtn.className = 'card-modal-duplicate';
    duplicateBtn.type = 'button';
    duplicateBtn.textContent = 'Duplicate';
    duplicateBtn.title = 'Create a copy of this card in the same column';
    duplicateBtn.setAttribute('aria-label', `Duplicate card "${record.card.title}"`);
    duplicateBtn.addEventListener('click', () => {
      // The host creates the copy, persists it, and opens the new card's
      // details, so close this modal to make room for it.
      post({ type: 'duplicateCard', cardId: record.card.id });
      closeCardDetails();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'card-modal-danger';
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.setAttribute('aria-label', `Delete card "${record.card.title}"`);
    deleteBtn.addEventListener('click', () => {
      // VS Code webviews do not support window.confirm (it returns false), so
      // confirmation happens on the extension host instead. Post the delete and
      // let the host confirm: on success the card vanishes from the next state
      // push (closing this modal); a cancelled delete leaves the modal open.
      post({ type: 'deleteCard', cardId: record.card.id });
    });

    footer.append(deleteBtn, duplicateBtn, spacer, save);

    syncRunAiButton();

    assigneeControls.kind.addEventListener('change', syncRunAiButton);

    dialog.append(header, form, footer);
    backdrop.appendChild(dialog);
    return backdrop;
  }

  function cardFormHasChanges(card, fields) {
    const nextTitle = normalizeText(fields.title.value);
    if (nextTitle !== normalizeText(card.title)) {
      return true;
    }

    const nextDescription = normalizeText(fields.description.value);
    if (nextDescription !== normalizeText(card.description)) {
      return true;
    }

    const nextAcceptanceCriteria = normalizeText(fields.acceptanceCriteria.value);
    if (nextAcceptanceCriteria !== normalizeText(card.acceptanceCriteria)) {
      return true;
    }

    const nextAssignee = readAssignee(fields.assigneeKind, fields.assigneeName);
    if (!assigneesEqual(card.assignee, nextAssignee)) {
      return true;
    }

    const nextDependencies = fields.getDependencies();
    if (!dependenciesEqual(Array.isArray(card.dependsOn) ? card.dependsOn : [], nextDependencies)) {
      return true;
    }

    return fields.columnSelect.value !== fields.currentColumnId;
  }

  function renderUnsavedChangesPrompt(backdrop, onSave, onDiscard, onDismiss) {
    const promptBackdrop = document.createElement('div');
    promptBackdrop.className = 'card-unsaved-changes-backdrop';

    const prompt = document.createElement('section');
    prompt.className = 'card-unsaved-changes-prompt';
    prompt.setAttribute('role', 'alertdialog');
    prompt.setAttribute('aria-modal', 'true');
    prompt.setAttribute('aria-label', 'Unsaved card changes');

    const title = document.createElement('h3');
    title.className = 'card-unsaved-changes-title';
    title.textContent = 'Save changes?';

    const message = document.createElement('p');
    message.className = 'card-unsaved-changes-message';
    message.textContent = 'This card has unsaved changes. What would you like to do?';

    const actions = document.createElement('div');
    actions.className = 'card-unsaved-changes-actions';

    const save = document.createElement('button');
    save.className = 'card-unsaved-changes-button card-unsaved-changes-save';
    save.type = 'button';
    save.textContent = 'Save';
    save.addEventListener('click', onSave);

    const discard = document.createElement('button');
    discard.className = 'card-unsaved-changes-button card-unsaved-changes-discard';
    discard.type = 'button';
    discard.textContent = 'Discard';
    discard.addEventListener('click', onDiscard);

    const cancel = document.createElement('button');
    cancel.className = 'card-unsaved-changes-button';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      promptBackdrop.remove();
      onDismiss();
    });

    promptBackdrop.addEventListener('click', (event) => {
      if (event.target === promptBackdrop) {
        promptBackdrop.remove();
        onDismiss();
      }
    });
    promptBackdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        promptBackdrop.remove();
        onDismiss();
      }
    });

    actions.append(save, discard, cancel);
    prompt.append(title, message, actions);
    promptBackdrop.appendChild(prompt);
    backdrop.appendChild(promptBackdrop);
    save.focus();
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
   * @param {string} currentColumnId
   */
  function renderColumnSelectorField(currentColumnId) {
    const wrapper = document.createElement('label');
    wrapper.className = 'card-field';

    const label = document.createElement('span');
    label.className = 'card-field-label';
    label.textContent = 'Column';

    const select = document.createElement('select');
    select.className = 'card-field-select';

    if (board) {
      for (const column of board.columns) {
        select.appendChild(createOption(column.id, column.title));
      }
    }
    select.value = currentColumnId;

    wrapper.append(label, select);
    return { wrapper, select };
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
      const hidden = kind.value === 'unassigned' || kind.value === 'ai';
      name.hidden = hidden;
      name.placeholder = 'Human name (optional)';
    };
    syncNameVisibility();
    kind.addEventListener('change', syncNameVisibility);

    row.append(kind, name);
    wrapper.append(label, row);
    return { wrapper, kind, name };
  }

  /**
   * Renders the dependency editor for a card: a list of current dependencies
   * (each removable) plus a picker to add another card from the board. The
   * card itself and already-selected cards are never offered, so a card can
   * neither depend on itself nor list the same dependency twice. The working
   * set is kept locally and only committed when the card is saved.
   * @param {Card} card
   */
  function renderDependencyControls(card, initialDeps) {
    const wrapper = document.createElement('div');
    wrapper.className = 'card-field';

    const label = document.createElement('span');
    label.className = 'card-field-label';
    label.textContent = 'Dependencies';

    /** @type {string[]} */
    const deps = [];
    const seen = new Set();
    const initial = initialDeps ?? (Array.isArray(card.dependsOn) ? card.dependsOn : []);
    for (const id of initial) {
      if (id !== card.id && !seen.has(id) && findCardRecord(id)) {
        seen.add(id);
        deps.push(id);
      }
    }

    const list = document.createElement('div');
    list.className = 'card-deps-list';

    const controls = document.createElement('div');
    controls.className = 'card-deps-controls';

    const select = document.createElement('select');
    select.className = 'card-field-select';

    const help = document.createElement('span');
    help.className = 'card-field-help';
    help.textContent = 'This card stays blocked until every dependency reaches a Done column.';

    const dependencyLabel = (id) => {
      const record = findCardRecord(id);
      return record ? record.card.title : id;
    };

    const otherCards = () => {
      const result = [];
      if (board) {
        for (const column of board.columns) {
          if (column.role === 'done') {
            continue;
          }
          for (const candidate of column.cards) {
            if (candidate.id !== card.id) {
              result.push(candidate);
            }
          }
        }
      }
      return result;
    };

    const renderOptions = () => {
      select.innerHTML = '';
      const available = otherCards().filter((candidate) => !deps.includes(candidate.id));
      const placeholder = createOption('', available.length > 0 ? 'Choose a card…' : 'No other cards available');
      placeholder.disabled = true;
      placeholder.selected = true;
      select.appendChild(placeholder);
      for (const candidate of available) {
        select.appendChild(createOption(candidate.id, candidate.title));
      }
      select.disabled = available.length === 0;
    };

    const renderList = () => {
      list.innerHTML = '';
      if (deps.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'card-deps-empty';
        empty.textContent = 'No dependencies.';
        list.appendChild(empty);
        return;
      }
      const blockingDepIds = new Set(blockingDependencies({ ...card, dependsOn: deps }));
      for (const id of deps) {
        const chip = document.createElement('span');
        chip.className = `card-chip card-chip-dep ${blockingDepIds.has(id) ? 'card-chip-dep-blocked' : 'card-chip-dep-unblocked'}`;

        const text = document.createElement('span');
        text.textContent = dependencyLabel(id);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'card-dep-remove';
        remove.textContent = '×';
        remove.title = `Remove dependency ${dependencyLabel(id)}`;
        remove.setAttribute('aria-label', `Remove dependency ${dependencyLabel(id)}`);
        remove.addEventListener('click', () => {
          const index = deps.indexOf(id);
          if (index !== -1) {
            deps.splice(index, 1);
          }
          renderList();
          renderOptions();
        });

        chip.append(text, remove);
        list.appendChild(chip);
      }
    };

    select.addEventListener('change', () => {
      const value = select.value;
      if (!value || value === card.id || deps.includes(value)) {
        return;
      }
      deps.push(value);
      renderList();
      renderOptions();
    });

    renderList();
    renderOptions();
    controls.append(select);
    wrapper.append(label, list, controls, help);
    return { wrapper, getDependencies: () => deps.slice() };
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

    titleBlock.append(title);

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

    const nextDependencies = fields.getDependencies();
    if (!dependenciesEqual(Array.isArray(card.dependsOn) ? card.dependsOn : [], nextDependencies)) {
      post({ type: 'setDependencies', cardId: card.id, dependsOn: nextDependencies });
    }

    if (fields.columnSelect && fields.currentColumnId) {
      const nextColumnId = fields.columnSelect.value;
      if (nextColumnId && nextColumnId !== fields.currentColumnId) {
        const targetColumn = board ? board.columns.find((col) => col.id === nextColumnId) : null;
        const toIndex = targetColumn ? targetColumn.cards.length : 0;
        post({ type: 'moveCard', cardId: card.id, toColumnId: nextColumnId, toIndex });
      }
    }
  }

  function dependenciesEqual(left, right) {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((id, index) => id === right[index]);
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

    if (kindField.value === 'ai') {
      return { kind: 'ai' };
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

  function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  /**
   * Whether a card is "defined" (ready to start): it needs BOTH a non-empty
   * Description and non-empty Acceptance criteria. Mirrors isCardDefined in
   * src/cardDefinition.ts — keep the two in sync.
   * @param {Card} card
   */
  function isCardDefined(card) {
    return normalizeText(card.description).length > 0 && normalizeText(card.acceptanceCriteria).length > 0;
  }

  /**
   * The ids of a card's dependencies that are not yet complete. A dependency is
   * complete once its card sits in a Done-role column; references to cards that
   * no longer exist are ignored. Mirrors blockingDependencies in src/utils.ts.
   * @param {Card} card
   */
  function blockingDependencies(card) {
    if (!board || !Array.isArray(card.dependsOn) || card.dependsOn.length === 0) {
      return [];
    }
    const doneIds = new Set();
    const existingIds = new Set();
    for (const column of board.columns) {
      const done = column.role === 'done';
      for (const candidate of column.cards) {
        existingIds.add(candidate.id);
        if (done) {
          doneIds.add(candidate.id);
        }
      }
    }
    return card.dependsOn.filter((id) => existingIds.has(id) && !doneIds.has(id));
  }

  /**
   * @param {Card} card
   */
  function isCardBlocked(card) {
    return blockingDependencies(card).length > 0;
  }

  /**
   * @param {Card} card
   */
  function countBlockingDependencies(card) {
    return blockingDependencies(card).length;
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

  /**
   * Wire an element as a card drop target for a column. The insertion index is
   * supplied by `resolveIndex`, so the `.cards` list can derive it from the
   * pointer while a `.column-header` can pin it to a fixed end of the column.
   * @param {HTMLElement} element
   * @param {string} columnId
   * @param {(event: Event) => number} resolveIndex
   */
  function wireDropTarget(element, columnId, resolveIndex) {
    element.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (draggedCardId && !canDropCardInColumn(draggedCardId, columnId)) {
        element.classList.remove('drag-over');
        element.classList.add('drop-blocked');
        const dragEvent = /** @type {DragEvent} */ (event);
        if (dragEvent.dataTransfer) {
          dragEvent.dataTransfer.dropEffect = 'none';
        }
        return;
      }
      element.classList.remove('drop-blocked');
      element.classList.add('drag-over');
    });
    element.addEventListener('dragleave', () => {
      element.classList.remove('drag-over');
      element.classList.remove('drop-blocked');
    });
    element.addEventListener('drop', (event) => {
      event.preventDefault();
      element.classList.remove('drag-over');
      element.classList.remove('drop-blocked');
      if (!draggedCardId) {
        return;
      }
      // A blocked card cannot advance past Ready; ignore the drop so it snaps back.
      if (!canDropCardInColumn(draggedCardId, columnId)) {
        return;
      }
      const toIndex = resolveIndex(event);
      post({ type: 'moveCard', cardId: draggedCardId, toColumnId: columnId, toIndex });
    });
  }

  /**
   * Mirrors canMoveCardToColumn in src/utils.ts: a blocked card may not advance
   * past the Ready column, though it can stay put, move back, or be reordered
   * within its own column. Keep the two in sync.
   * @param {string} cardId
   * @param {string} columnId
   */
  function canDropCardInColumn(cardId, columnId) {
    if (!board) {
      return true;
    }
    const record = findCardRecord(cardId);
    if (!record || record.column.id === columnId) {
      return true;
    }
    if (!isCardBlocked(record.card)) {
      return true;
    }

    const targetIndex = board.columns.findIndex((column) => column.id === columnId);
    if (targetIndex === -1) {
      return true;
    }

    const readyIndex = board.columns.findIndex((column) => column.role === 'ready');
    if (readyIndex === -1) {
      const role = board.columns[targetIndex].role;
      return role === 'backlog' || role === 'ready';
    }
    return targetIndex <= readyIndex;
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

  // Ctrl/Cmd + mouse wheel zooms the board. preventDefault stops the webview's
  // own page zoom so only the board scales.
  root.addEventListener(
    'wheel',
    (event) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      event.preventDefault();
      setZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    },
    { passive: false },
  );

  // Ctrl/Cmd + "+" / "-" / "0" zoom in, out, and reset. "=" and the numpad keys
  // are accepted too so the shortcut works without pressing Shift.
  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }
    switch (event.key) {
      case '+':
      case '=':
      case 'Add':
        event.preventDefault();
        setZoom(zoom + ZOOM_STEP);
        break;
      case '-':
      case '_':
      case 'Subtract':
        event.preventDefault();
        setZoom(zoom - ZOOM_STEP);
        break;
      case '0':
        event.preventDefault();
        setZoom(ZOOM_DEFAULT);
        break;
    }
  });

  render();
  post({ type: 'ready' });
})();
