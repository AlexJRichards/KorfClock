/**
 * KorfClock Server
 * Real-time korfball shot clock using Express + Socket.IO.
 * The server is the single source of truth for all timer state.
 * All connected clients are kept in sync via Socket.IO events.
 * Sessions are isolated by room code so multiple games can run concurrently.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

const CLIENT_DIR = path.join(__dirname, '../client');

// ─── Rate limiting ────────────────────────────────────────────────────────────

// Limit page requests to 60 per minute per IP (generous for normal usage)
const pageRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// Limit session creation to 20 per minute per IP
const createSessionRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/',           pageRateLimit, (req, res) => res.sendFile(path.join(CLIENT_DIR, 'index.html')));
app.get('/controller', pageRateLimit, (req, res) => res.sendFile(path.join(CLIENT_DIR, 'controller.html')));
app.get('/display',    pageRateLimit, (req, res) => res.sendFile(path.join(CLIENT_DIR, 'display.html')));

// Create a new session and return its room code
app.post('/api/create-session', createSessionRateLimit, (req, res) => {
  const roomCode = generateRoomCode();
  sessions.set(roomCode, createSession());
  console.log(`[+] Session created: ${roomCode} (total: ${sessions.size})`);
  res.json({ roomCode });
});

// Serve any other static assets (Socket.IO client JS is served automatically)
app.use(express.static(CLIENT_DIR));

// ─── Session management ───────────────────────────────────────────────────────

/**
 * Active sessions keyed by 5-digit room code string.
 * Each session holds its own timer state and tick interval.
 */
const sessions = new Map();

/** Creates a fresh session state object. */
function createSession() {
  return {
    mode: 'shotclock',     // 'shotclock' | 'timeout'
    running: false,
    startTime: null,       // server ms timestamp when timer was last started/resumed
    startRemaining: 25,    // seconds remaining at the moment the timer was started/resumed
    remaining: 25,         // seconds remaining when paused (accurate only while paused)
    tickInterval: null,    // setInterval handle for expiry detection
  };
}

/** Generates a 5-digit numeric room code that is not already in use. */
function generateRoomCode() {
  let code;
  do {
    code = String(Math.floor(Math.random() * 90000) + 10000);
  } while (sessions.has(code));
  return code;
}

// ─── Per-session timer helpers ────────────────────────────────────────────────

/** Returns the current remaining seconds for a session (accurate regardless of running state). */
function getCurrentRemaining(session) {
  if (!session.running) return session.remaining;
  const elapsed = (Date.now() - session.startTime) / 1000;
  return Math.max(0, session.startRemaining - elapsed);
}

/**
 * Broadcasts the full timer state + current server timestamp to all clients in a room.
 * The serverTime field lets clients compensate for clock skew / network latency.
 */
function broadcastState(roomCode, session) {
  const { tickInterval: _tick, ...state } = session;
  io.to(roomCode).emit('timerUpdate', { ...state, serverTime: Date.now() });
}

/** Starts a lightweight server-side tick that detects when the timer expires. */
function startTick(roomCode, session) {
  if (session.tickInterval) clearInterval(session.tickInterval);
  session.tickInterval = setInterval(() => {
    if (getCurrentRemaining(session) <= 0) {
      // Timer expired – stop and notify all clients in the room
      session.running = false;
      session.remaining = 0;
      session.startTime = null;
      clearInterval(session.tickInterval);
      session.tickInterval = null;
      broadcastState(roomCode, session);
    }
  }, 100); // check every 100 ms is plenty accurate
}

/** Stops the server-side tick interval for a session. */
function stopTick(session) {
  if (session.tickInterval) {
    clearInterval(session.tickInterval);
    session.tickInterval = null;
  }
}

// ─── Socket.IO ───────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[+] Client connected:    ${socket.id}`);

  // ── joinRoom ───────────────────────────────────────────────────────────────
  // Client must join a room before any timer events are processed.
  socket.on('joinRoom', (roomCode) => {
    // Validate format: must be a 5-digit string
    if (typeof roomCode !== 'string' || !/^\d{5}$/.test(roomCode)) {
      socket.emit('roomError', 'Session not found. Please check your code.');
      return;
    }
    const session = sessions.get(roomCode);
    if (!session) {
      socket.emit('roomError', 'Session not found. Please check your code.');
      return;
    }
    socket.join(roomCode);
    // Store room code on the socket for use in subsequent event handlers
    socket.roomCode = roomCode;
    console.log(`[~] ${socket.id} joined room ${roomCode}`);
    // Sync the new client to the current session state
    const { tickInterval: _tick, ...state } = session;
    socket.emit('timerUpdate', { ...state, serverTime: Date.now() });
  });

  // ── start ──────────────────────────────────────────────────────────────────
  socket.on('start', () => {
    const session = sessions.get(socket.roomCode);
    if (!session) return;
    if (session.running) return; // already running, ignore
    session.startRemaining = session.remaining;
    session.startTime = Date.now();
    session.running = true;
    broadcastState(socket.roomCode, session);
    startTick(socket.roomCode, session);
  });

  // ── stop ───────────────────────────────────────────────────────────────────
  socket.on('stop', () => {
    const session = sessions.get(socket.roomCode);
    if (!session) return;
    if (!session.running) return; // already stopped, ignore
    session.remaining = getCurrentRemaining(session);
    session.running = false;
    session.startTime = null;
    stopTick(session);
    broadcastState(socket.roomCode, session);
  });

  // ── reset ──────────────────────────────────────────────────────────────────
  // Resets to 25-second shot clock.
  // If the clock was running, immediately resumes counting down.
  // If the clock was paused/stopped, stays paused at 25s.
  socket.on('reset', () => {
    const session = sessions.get(socket.roomCode);
    if (!session) return;
    const wasRunning = session.running;
    stopTick(session);
    session.mode = 'shotclock';
    session.remaining = 25;
    session.startRemaining = 25;
    if (wasRunning) {
      session.startTime = Date.now();
      session.running = true;
      broadcastState(socket.roomCode, session);
      startTick(socket.roomCode, session);
    } else {
      session.startTime = null;
      session.running = false;
      broadcastState(socket.roomCode, session);
    }
  });

  // ── timeout ────────────────────────────────────────────────────────────────
  // Switches to 60-second timeout mode and immediately starts counting down.
  socket.on('timeout', () => {
    const session = sessions.get(socket.roomCode);
    if (!session) return;
    stopTick(session);
    session.mode = 'timeout';
    session.remaining = 60;
    session.startRemaining = 60;
    session.startTime = Date.now();
    session.running = true;
    broadcastState(socket.roomCode, session);
    startTick(socket.roomCode, session);
  });

  socket.on('disconnect', async () => {
    console.log(`[-] Client disconnected: ${socket.id}`);
    // Clean up session if no clients remain in the room
    if (socket.roomCode) {
      const room = io.sockets.adapter.rooms.get(socket.roomCode);
      if (!room || room.size === 0) {
        const session = sessions.get(socket.roomCode);
        if (session) stopTick(session);
        sessions.delete(socket.roomCode);
        console.log(`[x] Session removed:     ${socket.roomCode} (total: ${sessions.size})`);
      }
    }
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`KorfClock running on http://localhost:${PORT}`);
  console.log(`  Controller: http://localhost:${PORT}/controller`);
  console.log(`  Display:    http://localhost:${PORT}/display`);
});
