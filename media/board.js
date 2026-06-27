// @ts-check
// Webview UI for MWNN Kanban. Plain browser JS — no Node or vscode imports.
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
    if (!board) {
      return;
    }
    for (const column of board.columns) {
      root.appendChild(renderColumn(column));
    }
  }

  function renderColumn(column) {
    const el = document.createElement('div');
    el.className = 'column';

    const header = document.createElement('div');
    header.className = 'column-header';
    const title = document.createElement('span');
    title.textContent = column.title;
    const count = document.createElement('span');
    count.className = 'column-count';
    count.textContent = String(column.cards.length);
    header.append(title, count);
    el.appendChild(header);

    const cards = document.createElement('div');
    cards.className = 'cards';
    cards.dataset.columnId = column.id;
    for (const card of column.cards) {
      cards.appendChild(renderCard(card));
    }
    wireDropTarget(cards, column.id);
    el.appendChild(cards);

    const add = document.createElement('button');
    add.className = 'add-card';
    add.textContent = '+ Add card';
    add.addEventListener('click', () => {
      const text = window.prompt('Card title');
      if (text && text.trim()) {
        post({ type: 'addCard', columnId: column.id, title: text.trim() });
      }
    });
    el.appendChild(add);

    return el;
  }

  function renderCard(card) {
    const el = document.createElement('div');
    el.className = 'card';
    el.draggable = true;
    el.dataset.cardId = card.id;

    const label = document.createElement('span');
    label.textContent = card.title;
    label.addEventListener('dblclick', () => {
      const text = window.prompt('Edit card', card.title);
      if (text !== null && text.trim()) {
        post({ type: 'editCard', cardId: card.id, title: text.trim() });
      }
    });

    const del = document.createElement('button');
    del.className = 'card-delete';
    del.textContent = '✕';
    del.title = 'Delete card';
    del.addEventListener('click', () => post({ type: 'deleteCard', cardId: card.id }));

    el.append(label, del);

    el.addEventListener('dragstart', () => {
      draggedCardId = card.id;
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      draggedCardId = null;
      el.classList.remove('dragging');
    });

    return el;
  }

  function wireDropTarget(cards, columnId) {
    cards.addEventListener('dragover', (event) => {
      event.preventDefault();
      cards.classList.add('drag-over');
    });
    cards.addEventListener('dragleave', () => cards.classList.remove('drag-over'));
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

  post({ type: 'ready' });
})();
