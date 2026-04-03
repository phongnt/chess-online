(() => {
  const socket = io();
  const $ = (sel) => document.querySelector(sel);

  // State
  let chess = new Chess();
  let myColor = null;
  let myName = '';
  let opponentName = '';
  let selectedSquare = null;
  let lastMove = null;
  let gameActive = false;

  // DOM refs
  const lobbyEl = $('#lobby');
  const waitingEl = $('#waiting');
  const gameEl = $('#game');
  const boardEl = $('#board');
  const statusEl = $('#status-text');
  const moveListEl = $('#move-list');
  const chatMsgsEl = $('#chat-messages');

  // Piece unicode map
  const PIECE = Chess.UNICODE;

  // --- Lobby ---
  $('#btn-create').addEventListener('click', () => {
    myName = $('#player-name').value.trim() || 'Player';
    socket.emit('create-room', myName);
  });

  $('#btn-join').addEventListener('click', () => {
    myName = $('#player-name').value.trim() || 'Player';
    const roomId = $('#room-code').value.trim().toUpperCase();
    if (!roomId) return;
    socket.emit('join-room', { roomId, playerName: myName });
  });

  // Enter key support
  $('#player-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btn-create').click();
  });
  $('#room-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btn-join').click();
  });

  // --- Socket events ---
  socket.on('room-created', ({ roomId, color }) => {
    myColor = color;
    lobbyEl.classList.add('hidden');
    waitingEl.classList.remove('hidden');
    $('#room-code-display').textContent = roomId;
    $('#lan-url').textContent = window.location.href;
  });

  socket.on('room-joined', ({ roomId, color, opponentName: oppName, moves }) => {
    myColor = color;
    opponentName = oppName;
    // Replay moves
    for (const m of moves) chess.move(m);
    startGame();
  });

  socket.on('opponent-joined', ({ opponentName: oppName }) => {
    opponentName = oppName;
    startGame();
  });

  socket.on('move', (move) => {
    const result = chess.move(move);
    if (result) {
      lastMove = { from: move.from, to: move.to };
      renderBoard();
      addMoveToList(result.san);
      updateStatus();
      playSound(result.captured ? 'capture' : 'move');
    }
  });

  socket.on('chat', (msg) => {
    addChatMessage(opponentName, msg);
  });

  socket.on('opponent-resigned', () => {
    gameActive = false;
    showModal('You Win!', 'Your opponent resigned.');
    $('#btn-rematch').classList.remove('hidden');
  });

  socket.on('opponent-disconnected', () => {
    gameActive = false;
    addSystemMessage('Opponent disconnected');
    statusEl.textContent = 'Opponent disconnected';
  });

  socket.on('rematch-offered', () => {
    addSystemMessage('Opponent wants a rematch!');
    $('#btn-rematch').classList.remove('hidden');
    $('#btn-rematch').textContent = 'Accept Rematch';
  });

  socket.on('rematch-start', ({ color }) => {
    myColor = color;
    chess = new Chess();
    lastMove = null;
    selectedSquare = null;
    moveListEl.innerHTML = '';
    gameActive = true;
    $('#btn-rematch').classList.add('hidden');
    $('#btn-rematch').textContent = 'Rematch';
    renderBoard();
    updateStatus();
    addSystemMessage('New game started! Colors swapped.');
  });

  socket.on('error-msg', (msg) => {
    alert(msg);
  });

  // --- Game ---
  function startGame() {
    lobbyEl.classList.add('hidden');
    waitingEl.classList.add('hidden');
    gameEl.classList.remove('hidden');
    gameActive = true;

    $('#my-name').textContent = `${myName} (${myColor === 'w' ? 'White' : 'Black'})`;
    $('#opponent-name').textContent = `${opponentName} (${myColor === 'w' ? 'Black' : 'White'})`;

    renderBoard();
    updateStatus();
  }

  function renderBoard() {
    boardEl.innerHTML = '';
    const board = chess.board(); // 8 rows, top = rank 8

    const rows = myColor === 'b' ? [...board].reverse() : board;

    for (let r = 0; r < 8; r++) {
      const cols = myColor === 'b' ? [...rows[r]].reverse() : rows[r];
      for (let f = 0; f < 8; f++) {
        const sq = document.createElement('div');

        // Calculate actual file and rank
        const actualFile = myColor === 'b' ? 7 - f : f;
        const actualRank = myColor === 'b' ? r : 7 - r;
        const squareName = 'abcdefgh'[actualFile] + (actualRank + 1);

        const isLight = (actualFile + actualRank) % 2 === 1;
        sq.className = `square ${isLight ? 'light' : 'dark'}`;
        sq.dataset.square = squareName;

        // Last move highlight
        if (lastMove && (squareName === lastMove.from || squareName === lastMove.to)) {
          sq.classList.add('last-move');
        }

        // Selected
        if (selectedSquare === squareName) {
          sq.classList.add('selected');
        }

        // Possible moves
        if (selectedSquare) {
          const possibleMoves = chess.moves({ square: selectedSquare, verbose: true });
          if (possibleMoves.some(m => m.to === squareName)) {
            sq.classList.add('possible');
            if (cols[f]) sq.classList.add('has-piece');
          }
        }

        // Piece
        const piece = cols[f];
        if (piece) {
          const span = document.createElement('span');
          span.className = 'piece';
          span.textContent = PIECE[piece.color + piece.type];
          sq.appendChild(span);
        }

        sq.addEventListener('click', () => onSquareClick(squareName));
        boardEl.appendChild(sq);
      }
    }

    updateCaptures();
  }

  function onSquareClick(square) {
    if (!gameActive) return;
    if (chess.turn() !== myColor) return;

    const piece = chess.get(square);

    // If a square is selected, try to move
    if (selectedSquare) {
      if (square === selectedSquare) {
        selectedSquare = null;
        renderBoard();
        return;
      }

      // Check if this is a valid move
      const possibleMoves = chess.moves({ square: selectedSquare, verbose: true });
      const validMove = possibleMoves.find(m => m.to === square);

      if (validMove) {
        makeMove(selectedSquare, square, validMove);
        return;
      }

      // If clicking own piece, select it instead
      if (piece && piece.color === myColor) {
        selectedSquare = square;
        renderBoard();
        return;
      }

      selectedSquare = null;
      renderBoard();
      return;
    }

    // Select own piece
    if (piece && piece.color === myColor) {
      selectedSquare = square;
      renderBoard();
    }
  }

  function makeMove(from, to, moveInfo) {
    // Handle promotion
    let promotion;
    if (moveInfo.piece === 'p' && (to[1] === '8' || to[1] === '1')) {
      promotion = promptPromotion();
      if (!promotion) return;
    }

    const moveData = { from, to };
    if (promotion) moveData.promotion = promotion;

    const result = chess.move(moveData);
    if (result) {
      lastMove = { from, to };
      selectedSquare = null;
      socket.emit('move', moveData);
      renderBoard();
      addMoveToList(result.san);
      updateStatus();
      playSound(result.captured ? 'capture' : 'move');
    }
  }

  function promptPromotion() {
    const choice = prompt('Promote to? (q=Queen, r=Rook, b=Bishop, n=Knight)', 'q');
    if (!choice) return null;
    const c = choice.toLowerCase()[0];
    return ['q', 'r', 'b', 'n'].includes(c) ? c : 'q';
  }

  function updateStatus() {
    if (chess.isCheckmate()) {
      const winner = chess.turn() === 'w' ? 'Black' : 'White';
      statusEl.textContent = `Checkmate! ${winner} wins`;
      gameActive = false;
      const iWin = (winner === 'White' && myColor === 'w') || (winner === 'Black' && myColor === 'b');
      showModal(iWin ? 'You Win!' : 'You Lose', `Checkmate! ${winner} wins.`);
      $('#btn-rematch').classList.remove('hidden');
    } else if (chess.isStalemate()) {
      statusEl.textContent = 'Stalemate - Draw';
      gameActive = false;
      showModal('Draw', 'Stalemate!');
      $('#btn-rematch').classList.remove('hidden');
    } else if (chess.isDraw()) {
      statusEl.textContent = 'Draw';
      gameActive = false;
      showModal('Draw', 'The game is a draw.');
      $('#btn-rematch').classList.remove('hidden');
    } else {
      const turn = chess.turn() === 'w' ? 'White' : 'Black';
      statusEl.textContent = `${turn} to move${chess.isCheck() ? ' (Check!)' : ''}`;
    }
  }

  // Move list
  let moveCount = 0;
  function addMoveToList(san) {
    moveCount++;
    if (moveCount % 2 === 1) {
      const num = document.createElement('span');
      num.className = 'move-num';
      num.textContent = Math.ceil(moveCount / 2) + '.';
      moveListEl.appendChild(num);
    }
    const span = document.createElement('span');
    span.className = 'move';
    span.textContent = san;
    moveListEl.appendChild(span);

    // Pad if white's move (need placeholder for grid)
    moveListEl.scrollTop = moveListEl.scrollHeight;
  }

  // Captures
  function updateCaptures() {
    const initial = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    const count = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = 'abcdefgh'[f] + (r + 1);
        const p = chess.get(sq);
        if (p && p.type !== 'k') count[p.color][p.type]++;
      }
    }

    const capturedBy = (color) => {
      const opp = color === 'w' ? 'b' : 'w';
      let str = '';
      for (const t of ['q', 'r', 'b', 'n', 'p']) {
        const diff = initial[t] - count[opp][t];
        for (let i = 0; i < diff; i++) str += PIECE[opp + t];
      }
      return str;
    };

    const myCaptures = capturedBy(myColor);
    const oppCaptures = capturedBy(myColor === 'w' ? 'b' : 'w');
    $('#my-captures').textContent = myCaptures;
    $('#opponent-captures').textContent = oppCaptures;
  }

  // Chat
  $('#btn-send-chat').addEventListener('click', sendChat);
  $('#chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  function sendChat() {
    const input = $('#chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    socket.emit('chat', msg);
    addChatMessage(myName, msg);
    input.value = '';
  }

  function addChatMessage(author, text) {
    const div = document.createElement('div');
    div.className = 'msg';
    div.innerHTML = `<span class="author">${escapeHtml(author)}:</span> ${escapeHtml(text)}`;
    chatMsgsEl.appendChild(div);
    chatMsgsEl.scrollTop = chatMsgsEl.scrollHeight;
  }

  function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'msg system';
    div.textContent = text;
    chatMsgsEl.appendChild(div);
    chatMsgsEl.scrollTop = chatMsgsEl.scrollHeight;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Game buttons
  $('#btn-resign').addEventListener('click', () => {
    if (!gameActive) return;
    if (confirm('Are you sure you want to resign?')) {
      socket.emit('resign');
      gameActive = false;
      statusEl.textContent = 'You resigned';
      showModal('You Resigned', 'Better luck next time!');
      $('#btn-rematch').classList.remove('hidden');
    }
  });

  $('#btn-rematch').addEventListener('click', () => {
    const text = $('#btn-rematch').textContent;
    if (text === 'Accept Rematch') {
      socket.emit('accept-rematch');
    } else {
      socket.emit('offer-rematch');
      $('#btn-rematch').textContent = 'Waiting...';
      $('#btn-rematch').disabled = true;
      addSystemMessage('Rematch offered');
    }
  });

  // Modal
  function showModal(title, text) {
    $('#modal-title').textContent = title;
    $('#modal-text').textContent = text;
    $('#modal-overlay').classList.remove('hidden');
  }

  $('#modal-close').addEventListener('click', () => {
    $('#modal-overlay').classList.add('hidden');
  });

  // Sound effects (Web Audio API)
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  function playSound(type) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'capture') {
      osc.frequency.value = 300;
      gain.gain.value = 0.15;
    } else {
      osc.frequency.value = 500;
      gain.gain.value = 0.08;
    }

    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    osc.stop(audioCtx.currentTime + 0.15);
  }
})();
