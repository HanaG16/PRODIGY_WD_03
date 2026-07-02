(() => {
  'use strict';

  /* ============================================================
     STATE
  ============================================================ */
  const state = {
    mode: null,            // 'ai' | 'local' | 'online'
    board: Array(9).fill(null),
    turn: 'X',
    names: { X: 'Player 1', O: 'Player 2' },
    scores: { X: 0, O: 0 },
    winner: null,          // 'X' | 'O' | 'draw' | null
    winLine: null,
    aiDifficulty: 'medium',
    humanMark: 'X',          // which mark the human plays as vs AI
    myRole: 'X',            // for online mode, which mark this tab controls
    roomCode: null,
    gameOver: false,
  };

  const WIN_LINES = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6],
  ];

  /* ============================================================
     DOM SHORTCUTS
  ============================================================ */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const screens = {
    home: $('#screen-home'),
    aiSetup: $('#screen-setup-ai'),
    localSetup: $('#screen-setup-local'),
    onlineSetup: $('#screen-setup-online'),
    game: $('#screen-game'),
  };

  const mascot = $('#mascot');
  const mascotBubble = $('#mascotBubble');
  const boardEl = $('#board');
  const cells = $$('.cell');
  const statusLine = $('#statusLine');
  const winLineSvg = $('#winLine');
  const winLineEl = $('#winLineEl');
  const toastEl = $('#toast');

  function showScreen(name){
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  function toast(msg, ms = 2200){
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  function setMascot(mood, bubbleText){
    mascot.className = 'mascot state-' + mood;
    if (bubbleText !== undefined){
      mascotBubble.textContent = bubbleText;
      mascotBubble.style.display = bubbleText ? 'block' : 'none';
    }
  }

  /* ============================================================
     HOME NAVIGATION
  ============================================================ */
  $$('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
      const mode = card.dataset.mode;
      if (mode === 'ai') showScreen('aiSetup');
      if (mode === 'local') showScreen('localSetup');
      if (mode === 'online') showScreen('onlineSetup');
    });
  });

  $$('.back-btn[data-back="home"]').forEach(btn => {
    btn.addEventListener('click', () => {
      leaveRoomIfAny();
      showScreen('home');
      setMascot('idle', 'Ready when you are!');
    });
  });

  /* ============================================================
     AI SETUP
  ============================================================ */
  $$('.diff-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      $$('.diff-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.aiDifficulty = pill.dataset.diff;
    });
  });

  $$('.mark-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      $$('.mark-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.humanMark = pill.dataset.mark;
    });
  });

  $('#startAiBtn').addEventListener('click', () => {
    const name = $('#aiName').value.trim() || 'Player 1';
    const humanMark = state.humanMark;
    const aiMark = humanMark === 'X' ? 'O' : 'X';
    state.mode = 'ai';
    state.names = { [humanMark]: name, [aiMark]: 'Rex' };
    state.myRole = humanMark;
    startNewGame();
  });

  /* ============================================================
     LOCAL SETUP
  ============================================================ */
  $('#startLocalBtn').addEventListener('click', () => {
    const n1 = $('#localName1').value.trim() || 'Player 1';
    const n2 = $('#localName2').value.trim() || 'Player 2';
    state.mode = 'local';
    state.names = { X: n1, O: n2 };
    state.myRole = 'X';
    startNewGame();
  });

  /* ============================================================
     ONLINE SETUP (localStorage-backed "room")
  ============================================================ */
  const roomKey = (code) => `ttt_room_${code}`;

  function genCode(){
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i=0;i<4;i++) c += chars[Math.floor(Math.random()*chars.length)];
    return c;
  }

  function readRoom(code){
    try { return JSON.parse(localStorage.getItem(roomKey(code))); }
    catch(e){ return null; }
  }
  function writeRoom(code, data){
    localStorage.setItem(roomKey(code), JSON.stringify(data));
  }

  function freshRoomBoard(){
    return {
      board: Array(9).fill(null),
      turn: 'X',
      winner: null,
      winLine: null,
      players: { X: null, O: null },
      rematch: { X:false, O:false },
      updatedAt: Date.now(),
    };
  }

  $('#createRoomBtn').addEventListener('click', () => {
    const name = $('#onlineName').value.trim() || 'Player 1';
    const code = genCode();
    const room = freshRoomBoard();
    room.players.X = name;
    writeRoom(code, room);

    state.mode = 'online';
    state.roomCode = code;
    state.myRole = 'X';
    state.names = { X: name, O: 'Waiting…' };

    $('#onlineChoice').classList.add('hidden');
    $('#onlineWaiting').classList.remove('hidden');
    $('#roomCodeDisplay').textContent = code;
    const link = buildShareLink(code);
    $('#shareLinkInput').value = link;

    watchRoom(code);
  });

  $('#copyLinkBtn').addEventListener('click', () => copyText($('#shareLinkInput').value));
  $('#gameCopyBtn').addEventListener('click', () => copyText($('#gameShareLink').textContent));

  function copyText(text){
    navigator.clipboard?.writeText(text).then(() => toast('Link copied!'))
      .catch(() => toast('Copy this: ' + text, 3500));
  }

  function buildShareLink(code){
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('room', code);
    return url.toString();
  }

  $('#joinRoomBtn').addEventListener('click', () => {
    const code = $('#joinCode').value.trim().toUpperCase();
    const name = $('#onlineName').value.trim() || 'Player 2';
    joinRoom(code, name);
  });

  $('#cancelRoomBtn').addEventListener('click', () => {
    leaveRoomIfAny();
    $('#onlineWaiting').classList.add('hidden');
    $('#onlineChoice').classList.remove('hidden');
  });

  function joinRoom(code, name){
    const room = readRoom(code);
    if (!room){
      toast("Room not found. Check the code.");
      return;
    }
    if (!room.players.X){
      toast("That room looks empty.");
      return;
    }
    if (room.players.O && room.players.O !== name){
      // already has a second player — join as spectator? Keep it simple: block.
      toast("That room is already full.");
      return;
    }
    room.players.O = name;
    writeRoom(code, room);

    state.mode = 'online';
    state.roomCode = code;
    state.myRole = 'O';
    state.names = { X: room.players.X, O: name };

    watchRoom(code);
    enterGameScreenFromRoom(room);
  }

  let roomPoll = null;
  function watchRoom(code){
    window.addEventListener('storage', onStorageEvent);
    clearInterval(roomPoll);
    // Fallback poll in case storage events are throttled/missed
    roomPoll = setInterval(() => {
      const room = readRoom(code);
      if (room) syncFromRoom(room);
    }, 1200);
  }

  function onStorageEvent(e){
    if (!state.roomCode) return;
    if (e.key !== roomKey(state.roomCode)) return;
    const room = readRoom(state.roomCode);
    if (room) syncFromRoom(room);
  }

  function syncFromRoom(room){
    // Waiting screen -> opponent just joined
    if (screens.onlineSetup.classList.contains('active') && room.players.O){
      state.names.O = room.players.O;
      enterGameScreenFromRoom(room);
      return;
    }
    if (screens.game.classList.contains('active')){
      state.board = room.board.slice();
      state.turn = room.turn;
      state.winner = room.winner;
      state.winLine = room.winLine;
      state.gameOver = !!room.winner;
      state.names.O = room.players.O || state.names.O;
      renderBoard();
      updateStatus();
      if (room.winner) handleRoundEnd(false);
      if (room.rematch && room.rematch.X && room.rematch.O){
        // both agreed — reset happens from whoever triggers write; just reflect fresh board
      }
    }
  }

  function enterGameScreenFromRoom(room){
    state.board = room.board.slice();
    state.turn = room.turn;
    state.winner = room.winner;
    state.gameOver = !!room.winner;
    state.scores = { X:0, O:0 };
    showScreen('game');
    $('#onlineShareStrip').classList.remove('hidden');
    $('#gameShareLink').textContent = buildShareLink(state.roomCode);
    renderScores();
    renderBoard();
    updateStatus();
    setMascot('idle', '');
  }

  function leaveRoomIfAny(){
    window.removeEventListener('storage', onStorageEvent);
    clearInterval(roomPoll);
    state.roomCode = null;
    $('#onlineShareStrip').classList.add('hidden');
  }

  // Auto-join if opened via ?room=CODE
  window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room');
    if (code){
      showScreen('onlineSetup');
      $('#joinCode').value = code.toUpperCase();
      toast('Enter your name, then tap Join room');
      $('#onlineName').focus();
    }
  });

  /* ============================================================
     GAME CORE
  ============================================================ */
  function startNewGame(){
    state.board = Array(9).fill(null);
    state.turn = 'X';
    state.winner = null;
    state.winLine = null;
    state.gameOver = false;
    showScreen('game');
    renderScores();
    renderBoard();
    updateStatus();
    setMascot('idle', '');
    if (state.mode === 'ai' && state.turn !== state.myRole) aiMoveSoon();
  }

  function renderScores(){
    $('#scoreNameX').textContent = state.names.X;
    $('#scoreNameO').textContent = state.names.O;
    $('#scoreX').textContent = state.scores.X;
    $('#scoreO').textContent = state.scores.O;
  }

  function renderBoard(){
    cells.forEach((cell, i) => {
      const v = state.board[i];
      cell.classList.remove('filled','x','o','win');
      cell.innerHTML = '';
      if (v){
        cell.classList.add('filled', v.toLowerCase());
        const span = document.createElement('span');
        span.className = 'mark';
        span.textContent = v === 'X' ? '✕' : '○';
        cell.appendChild(span);
      }
    });
    if (state.winLine){
      drawWinLine(state.winLine);
    } else {
      winLineSvg.classList.remove('show');
    }
  }

  const LINE_COORDS = {
    '0,1,2':[50,50,250,50], '3,4,5':[50,150,250,150], '6,7,8':[50,250,250,250],
    '0,3,6':[50,50,50,250], '1,4,7':[150,50,150,250], '2,5,8':[250,50,250,250],
    '0,4,8':[40,40,260,260], '2,4,6':[260,40,40,260],
  };
  function drawWinLine(line){
    const key = line.join(',');
    const coords = LINE_COORDS[key];
    if (!coords) return;
    winLineEl.setAttribute('x1', coords[0]);
    winLineEl.setAttribute('y1', coords[1]);
    winLineEl.setAttribute('x2', coords[2]);
    winLineEl.setAttribute('y2', coords[3]);
    winLineSvg.classList.add('show');
    line.forEach(i => cells[i].classList.add('win'));
  }

  function checkResult(board){
    for (const line of WIN_LINES){
      const [a,b,c] = line;
      if (board[a] && board[a] === board[b] && board[a] === board[c]){
        return { winner: board[a], line };
      }
    }
    if (board.every(v => v)) return { winner: 'draw', line: null };
    return { winner: null, line: null };
  }

  function updateStatus(){
    if (state.winner === 'draw'){
      statusLine.textContent = "It's a draw!";
      return;
    }
    if (state.winner){
      const winnerName = state.names[state.winner];
      statusLine.textContent = `${winnerName} wins! 🎉`;
      return;
    }
    const activeName = state.names[state.turn];
    if (state.mode === 'ai'){
      statusLine.textContent = state.turn === state.myRole ? 'Your turn' : `${activeName} is thinking…`;
    } else if (state.mode === 'online'){
      statusLine.textContent = state.turn === state.myRole ? 'Your turn' : `Waiting for ${activeName}…`;
    } else {
      statusLine.textContent = `${activeName}'s turn`;
    }
  }

  /* ---------- cell click ---------- */
  boardEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell || state.gameOver) return;
    const i = Number(cell.dataset.i);
    if (state.board[i]) return;

    if (state.mode === 'online' && state.turn !== state.myRole) return;
    if (state.mode === 'ai' && state.turn !== state.myRole) return;

    playMove(i);
  });

  function playMove(i){
    state.board[i] = state.turn;
    const result = checkResult(state.board);
    state.winner = result.winner;
    state.winLine = result.line;
    state.gameOver = !!result.winner;
    const justMoved = state.turn;
    state.turn = state.turn === 'X' ? 'O' : 'X';

    renderBoard();
    updateStatus();

    if (state.mode === 'online'){
      const room = readRoom(state.roomCode) || freshRoomBoard();
      room.board = state.board.slice();
      room.turn = state.turn;
      room.winner = state.winner;
      room.winLine = state.winLine;
      room.updatedAt = Date.now();
      writeRoom(state.roomCode, room);
    }

    if (state.gameOver){
      handleRoundEnd(true);
      return;
    }

    if (state.mode === 'ai' && state.turn !== state.myRole){
      aiMoveSoon();
    } else {
      setMascot('idle', '');
    }
  }

  function handleRoundEnd(bumpScore){
    if (state.winner && state.winner !== 'draw'){
      if (bumpScore) state.scores[state.winner]++;
      renderScores();
      if (state.mode === 'ai'){
        setMascot(state.winner === state.myRole ? 'sad' : 'happy',
          state.winner === state.myRole ? 'Nice one!' : 'Rawr! Got you!');
      } else {
        setMascot('happy', `${state.names[state.winner]} takes it!`);
      }
    } else if (state.winner === 'draw'){
      setMascot('thinking', 'Even match!');
    }
  }

  function aiMoveSoon(){
    setMascot('thinking', '');
    const delay = state.aiDifficulty === 'easy' ? 450 : 650;
    const aiMark = state.turn; // it's currently the AI's turn
    setTimeout(() => {
      if (state.gameOver) return;
      const i = pickAiMove(state.board, state.aiDifficulty, aiMark);
      if (i !== null && i !== undefined) playMove(i);
    }, delay);
  }

  /* ============================================================
     AI — minimax with adjustable "skill"
  ============================================================ */
  function emptyIndices(board){
    return board.map((v,i) => v ? null : i).filter(v => v !== null);
  }

  function pickAiMove(board, difficulty, aiMark){
    const empties = emptyIndices(board);
    if (empties.length === 0) return null;

    if (difficulty === 'easy'){
      // mostly random, occasionally smart
      if (Math.random() < 0.75) return empties[Math.floor(Math.random()*empties.length)];
      return bestMove(board, aiMark);
    }
    if (difficulty === 'medium'){
      if (Math.random() < 0.35) return empties[Math.floor(Math.random()*empties.length)];
      return bestMove(board, aiMark);
    }
    // hard — always optimal
    return bestMove(board, aiMark);
  }

  function bestMove(board, aiMark){
    const humanMark = aiMark === 'X' ? 'O' : 'X';
    let best = { score: -Infinity, index: null };
    for (const i of emptyIndices(board)){
      const next = board.slice();
      next[i] = aiMark;
      const score = minimax(next, 0, false, aiMark, humanMark);
      if (score > best.score){
        best = { score, index: i };
      }
    }
    return best.index;
  }

  function minimax(board, depth, isMaximizing, aiMark, humanMark){
    const result = checkResult(board);
    if (result.winner === aiMark) return 10 - depth;
    if (result.winner === humanMark) return depth - 10;
    if (result.winner === 'draw') return 0;

    const empties = emptyIndices(board);
    if (isMaximizing){
      let best = -Infinity;
      for (const i of empties){
        const next = board.slice();
        next[i] = aiMark;
        best = Math.max(best, minimax(next, depth+1, false, aiMark, humanMark));
      }
      return best;
    } else {
      let best = Infinity;
      for (const i of empties){
        const next = board.slice();
        next[i] = humanMark;
        best = Math.min(best, minimax(next, depth+1, true, aiMark, humanMark));
      }
      return best;
    }
  }

  /* ============================================================
     GAME ACTIONS
  ============================================================ */
  $('#quitGameBtn').addEventListener('click', () => {
    leaveRoomIfAny();
    showScreen('home');
    setMascot('idle', 'Ready when you are!');
  });
  $('#menuBtn').addEventListener('click', () => {
    leaveRoomIfAny();
    showScreen('home');
    setMascot('idle', 'Ready when you are!');
  });

  $('#rematchBtn').addEventListener('click', () => {
    if (state.mode === 'online'){
      const room = readRoom(state.roomCode) || freshRoomBoard();
      room.board = Array(9).fill(null);
      room.turn = 'X';
      room.winner = null;
      room.winLine = null;
      writeRoom(state.roomCode, room);
      state.board = room.board.slice();
      state.turn = 'X';
      state.winner = null;
      state.winLine = null;
      state.gameOver = false;
      renderBoard();
      updateStatus();
      setMascot('idle', '');
      return;
    }
    state.board = Array(9).fill(null);
    state.turn = 'X';
    state.winner = null;
    state.winLine = null;
    state.gameOver = false;
    renderBoard();
    updateStatus();
    setMascot('idle', '');
    if (state.mode === 'ai' && state.turn !== state.myRole) aiMoveSoon();
  });

  window.addEventListener('beforeunload', leaveRoomIfAny);
})();