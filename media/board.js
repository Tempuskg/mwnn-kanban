// @ts-check
// Webview UI for MWNN Kanban. Plain browser JS - no Node or vscode imports.
// Mirrors the message protocol declared in src/types.ts.
(function () {
  const vscode = acquireVsCodeApi();

  /** @type {{ version: number, columns: Array<{id:string,title:string,cards:Array<{id:string,title:string}>}> } | null} */
  let board = null;
  let draggedCardId = null;

  const root = /** @type {HTMLElement} */ (document.getElementById('board'));

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'state') {
      board = message.board;
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

    for (const column of board.columns) {
      root.appendChild(renderColumn(column));
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
    hint.textContent = 'Drag cards between columns, or use Edit and Delete on each card.';

    intro.append(title, hint);
    return intro;
  }

  function renderLoadingState() {
    const loading = document.createElement('div');
    loading.className = 'board-empty';
    loading.textContent = 'Loading board state...';
    return loading;
  }

  function renderColumn(column) {
    const el = document.createElement('section');
    el.className = 'column';
    el.setAttribute('aria-label', column.title);

    const header = document.createElement('div');
    header.className = 'column-header';
    const title = document.createElement('h2');
    title.className = 'column-title';
    title.textContent = column.title;
    const count = document.createElement('span');
    count.className = 'column-count';
    count.textContent = String(column.cards.length);
    header.append(title, count);
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

  function renderColumnEmptyState() {
    const empty = document.createElement('p');
    empty.className = 'column-empty';
    empty.textContent = 'No cards yet. Add one to get started.';
    return empty;
  }

  function renderCard(card) {
    const el = document.createElement('article');
    el.className = 'card';
    el.draggable = true;
    el.dataset.cardId = card.id;
    el.setAttribute('role', 'listitem');
    el.setAttribute('aria-label', card.title);

    const label = document.createElement('span');
    label.className = 'card-title';
    label.textContent = card.title;
    label.addEventListener('dblclick', () => {
      editCard(card);
    });

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const edit = document.createElement('button');
    edit.className = 'card-action';
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.title = 'Edit card';
    edit.setAttribute('aria-label', `Edit ${card.title}`);
    edit.addEventListener('click', () => {
      editCard(card);
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

    actions.append(edit, del);
    el.append(label, actions);

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

  function editCard(card) {
    const text = window.prompt('Edit card', card.title);
    if (text !== null && text.trim()) {
      post({ type: 'editCard', cardId: card.id, title: text.trim() });
    }
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
