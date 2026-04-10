/**
 * KorfClock Server
 * Real-time korfball shot clock using Express + Socket.IO.
 * The server is the single source of truth for all timer state.
 * All connected clients are kept in sync via Socket.IO events.
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

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/',           pageRateLimit, (req, res) => res.sendFile(path.join(CLIENT_DIR, 'index.html')));
app.get('/controller', pageRateLimit, (req, res) => res.sendFile(path.join(CLIENT_DIR, 'controller.html')));
app.get('/display',    pageRateLimit, (req, res) => res.sendFile(path.join(CLIENT_DIR, 'display.html')));

// Serve any other static assets (Socket.IO client JS is served automatically)
app.use(express.static(CLIENT_DIR));

// ─── Timer State ─────────────────────────────────────────────────────────────

/**
 * Central timer state.
 *
 * When running:
 *   actual remaining = startRemaining - (Date.now() - startTime) / 1000
 *
 * When paused:
 *   actual remaining = remaining
 */
let timerState = {
  mode: 'shotclock',     // 'shotclock' | 'timeout'
  running: false,
  startTime: null,       // server ms timestamp when timer was last started/resumed
  startRemaining: 25,    // seconds remaining at the moment the timer was started/resumed
  remaining: 25,         // seconds remaining when paused (accurate only while paused)
};

/** Returns the current remaining seconds (accurate regardless of running state). */
function getCurrentRemaining() {
  if (!timerState.running) return timerState.remaining;
  const elapsed = (Date.now() - timerState.startTime) / 1000;
  return Math.max(0, timerState.startRemaining - elapsed);
}

/**
 * Broadcasts the full timer state + current server timestamp to all clients.
 * The serverTime field lets clients compensate for clock skew / network latency.
 */
function broadcastState() {
  io.emit('timerUpdate', { ...timerState, serverTime: Date.now() });
}

// ─── Server-side expiry tick ──────────────────────────────────────────────────

let tickInterval = null;

/** Starts a lightweight server-side tick that detects when the timer expires. */
function startTick() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    if (getCurrentRemaining() <= 0) {
      // Timer expired – stop and notify all clients
      timerState.running = false;
      timerState.remaining = 0;
      timerState.startTime = null;
      clearInterval(tickInterval);
      tickInterval = null;
      broadcastState();
    }
  }, 100); // check every 100 ms is plenty accurate
}

/** Stops the server-side tick interval. */
function stopTick() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

// ─── Socket.IO ───────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[+] Client connected:    ${socket.id}`);

  // Immediately sync the new client to the current state
  socket.emit('timerUpdate', { ...timerState, serverTime: Date.now() });

  // ── start ──────────────────────────────────────────────────────────────────
  socket.on('start', () => {
    if (timerState.running) return; // already running, ignore
    timerState.startRemaining = timerState.remaining;
    timerState.startTime = Date.now();
    timerState.running = true;
    broadcastState();
    startTick();
  });

  // ── stop ───────────────────────────────────────────────────────────────────
  socket.on('stop', () => {
    if (!timerState.running) return; // already stopped, ignore
    timerState.remaining = getCurrentRemaining();
    timerState.running = false;
    timerState.startTime = null;
    stopTick();
    broadcastState();
  });

  // ── reset ──────────────────────────────────────────────────────────────────
  // Resets to 25-second shot clock and immediately starts counting down.
  socket.on('reset', () => {
    stopTick();
    timerState.mode = 'shotclock';
    timerState.remaining = 25;
    timerState.startRemaining = 25;
    timerState.startTime = Date.now();
    timerState.running = true;
    broadcastState();
    startTick();
  });

  // ── timeout ────────────────────────────────────────────────────────────────
  // Switches to 60-second timeout mode and immediately starts counting down.
  socket.on('timeout', () => {
    stopTick();
    timerState.mode = 'timeout';
    timerState.remaining = 60;
    timerState.startRemaining = 60;
    timerState.startTime = Date.now();
    timerState.running = true;
    broadcastState();
    startTick();
  });

  socket.on('disconnect', () => {
    console.log(`[-] Client disconnected: ${socket.id}`);
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`KorfClock running on http://localhost:${PORT}`);
  console.log(`  Controller: http://localhost:${PORT}/controller`);
  console.log(`  Display:    http://localhost:${PORT}/display`);
});
