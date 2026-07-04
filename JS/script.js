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
    isHost: false,
    peer: null,
    conn: null,
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
     ONLINE SETUP — real peer-to-peer via WebRTC (PeerJS)
     Works across different devices/browsers, not just same-browser tabs.
  ============================================================ */
  const PEER_PREFIX = 'fen-ttt-';

  function genCode(){
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789'; // no ambiguous chars
    let c = '';
    for (let i=0;i<5;i++) c += chars[Math.floor(Math.random()*chars.length)];
    return c;
  }

  function peerIdForCode(code){
    return PEER_PREFIX + code.toLowerCase().trim();
  }

  function buildShareLink(code){
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('room', code);
    return url.toString();
  }

  $('#copyLinkBtn').addEventListener('click', () => copyText($('#shareLinkInput').value));
  $('#gameCopyBtn').addEventListener('click', () => copyText($('#gameShareLink').textContent));

  function copyText(text){
    navigator.clipboard?.writeText(text).then(() => toast('Link copied!'))
      .catch(() => toast('Copy this: ' + text, 3500));
  }

  function setWaitingText(msg){
    const el = $('#waitingMsgText');
    if (el) el.textContent = msg;
  }

  // ---- shared peer/connection plumbing ----
  function destroyPeer(){
    if (state.conn){
      try { state.conn.close(); } catch(e){}
      state.conn = null;
    }
    if (state.peer){
      try { state.peer.destroy(); } catch(e){}
      state.peer = null;
    }
  }

  function sendState(extra){
    if (!state.conn || !state.conn.open) return;
    state.conn.send(Object.assign({
      type: 'state',
      board: state.board,
      turn: state.turn,
      winner: state.winner,
      winLine: state.winLine,
      names: state.names,
    }, extra || {}));
  }

  function wireConnection(conn, myName){
    state.conn = conn;
    conn.on('open', () => {
      conn.send({ type:'hello', name: myName });
      if (state.isHost) setWaitingText('Connected — syncing up…');
    });
    conn.on('data', (data) => handlePeerData(data));
    conn.on('close', () => {
      toast("Your friend disconnected.");
    });
    conn.on('error', () => {
      toast("Connection hiccup — you may need to reconnect.");
    });
  }

  function handlePeerData(data){
    if (!data || !data.type) return;

    if (data.type === 'hello'){
      if (state.isHost){
        state.names.O = data.name;
        // Host is authoritative on the very first handshake: send a fresh board.
        state.board = Array(9).fill(null);
        state.turn = 'X';
        state.winner = null;
        state.winLine = null;
        state.gameOver = false;
        enterGameScreenFromPeer();
        sendState();
      } else {
        state.names.X = data.name;
      }
      return;
    }

    if (data.type === 'state'){
      state.board = data.board.slice();
      state.turn = data.turn;
      state.winner = data.winner;
      state.winLine = data.winLine;
      state.gameOver = !!data.winner;
      if (data.names){
        state.names.X = data.names.X || state.names.X;
        state.names.O = data.names.O || state.names.O;
      }
      if (!screens.game.classList.contains('active')){
        enterGameScreenFromPeer();
      } else {
        renderScores();
        renderBoard();
        updateStatus();
        if (state.winner) handleRoundEnd(false);
        else setMascot('idle', '');
      }
      return;
    }
  }

  function enterGameScreenFromPeer(){
    state.scores = { X:0, O:0 };
    showScreen('game');
    $('#onlineShareStrip').classList.remove('hidden');
    $('#gameShareLink').textContent = buildShareLink(state.roomCode);
    renderScores();
    renderBoard();
    updateStatus();
    setMascot('idle', '');
  }

  // ---- create room (host) ----
  $('#createRoomBtn').addEventListener('click', () => {
    const name = $('#onlineName').value.trim() || 'Player 1';
    const code = genCode();

    state.mode = 'online';
    state.isHost = true;
    state.roomCode = code;
    state.myRole = 'X';
    state.names = { X: name, O: 'Waiting…' };

    $('#onlineChoice').classList.add('hidden');
    $('#onlineWaiting').classList.remove('hidden');
    $('#roomCodeDisplay').textContent = code.toUpperCase();
    $('#shareLinkInput').value = buildShareLink(code);
    setWaitingText('Setting up your room…');

    destroyPeer();
    state.peer = new Peer(peerIdForCode(code));

    state.peer.on('open', () => {
      setWaitingText('Waiting for your friend to join…');
    });
    state.peer.on('connection', (conn) => {
      wireConnection(conn, name);
    });
    state.peer.on('error', (err) => {
      if (err && err.type === 'unavailable-id'){
        toast("That code just got taken — creating a new one.");
        $('#createRoomBtn').click();
      } else {
        toast("Couldn't set up the room. Check your connection and try again.");
      }
    });
  });

  // ---- join room (guest) ----
  $('#joinRoomBtn').addEventListener('click', () => {
    const code = $('#joinCode').value.trim().toLowerCase();
    const name = $('#onlineName').value.trim() || 'Player 2';
    if (!code){
      toast('Enter a room code first.');
      return;
    }
    joinRoom(code, name);
  });

  function joinRoom(code, name){
    state.mode = 'online';
    state.isHost = false;
    state.roomCode = code;
    state.myRole = 'O';
    state.names = { X: 'Player 1', O: name };

    destroyPeer();
    state.peer = new Peer();

    toast('Connecting…');

    state.peer.on('open', () => {
      const conn = state.peer.connect(peerIdForCode(code), { reliable: true });
      wireConnection(conn, name);
      conn.on('error', () => {
        toast("Couldn't reach that room. Double-check the code.");
      });
    });
    state.peer.on('error', (err) => {
      if (err && err.type === 'peer-unavailable'){
        toast("Room not found. Check the code and try again.");
      } else {
        toast("Connection error. Check your internet and try again.");
      }
    });
  }

  $('#cancelRoomBtn').addEventListener('click', () => {
    leaveRoomIfAny();
    $('#onlineWaiting').classList.add('hidden');
    $('#onlineChoice').classList.remove('hidden');
  });

  function leaveRoomIfAny(){
    destroyPeer();
    state.roomCode = null;
    $('#onlineShareStrip').classList.add('hidden');
  }

  // Auto-fill room code if opened via ?room=CODE
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
      sendState();
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
      state.board = Array(9).fill(null);
      state.turn = 'X';
      state.winner = null;
      state.winLine = null;
      state.gameOver = false;
      renderBoard();
      updateStatus();
      setMascot('idle', '');
      sendState();
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
