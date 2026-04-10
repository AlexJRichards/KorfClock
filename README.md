# KorfClock

Real-time korfball shot clock system built with **Node.js**, **Express**, and **Socket.IO**.

## Features

- 25-second shot clock, 60-second timeout mode
- Multiple clients stay perfectly in sync via WebSockets
- Smooth countdown with tenths-of-a-second display in the last 5 seconds
- Colour-coded timer (green → yellow → red) and expiry beep + flash
- Separate **Controller** (phone) and **Display** (tablet/screen) views

## Project Structure

```
KorfClock/
├── server/          # Node.js backend
│   ├── server.js    # Express + Socket.IO server
│   └── package.json
├── client/          # Static frontend (served by the server)
│   ├── index.html   # Landing page
│   ├── controller.html  # Controller UI (Start/Stop/Reset/Timeout)
│   └── display.html     # Fullscreen timer display
└── README.md
```

## Running Locally

### Prerequisites
- Node.js ≥ 16

### Install & Start

```bash
cd server
npm install
npm start
```

The server starts on **http://localhost:3000** by default.

| URL | Purpose |
|-----|---------|
| `http://localhost:3000/` | Landing page |
| `http://localhost:3000/controller` | Controller UI (use on phone) |
| `http://localhost:3000/display` | Fullscreen display (use on tablet/screen) |

### Using on the same network (phone + tablet)

1. Find the host machine's local IP (e.g. `192.168.1.10`).
2. Open `http://192.168.1.10:3000/controller` on your phone.
3. Open `http://192.168.1.10:3000/display` on a tablet or second screen.
4. All devices stay in sync automatically.

## Deploying

Set the `PORT` environment variable to override the default port:

```bash
PORT=8080 npm start
```

The app can be deployed to any Node.js hosting platform (Heroku, Railway, Render, etc.) by deploying the `server/` directory and ensuring the `client/` directory is available at `../client` relative to `server.js`.

## Controls

| Button | Action |
|--------|--------|
| **▶ Start** | Resume countdown from current time |
| **⏸ Stop** | Pause the countdown |
| **↺ Reset (25s)** | Reset to 25 s and immediately start |
| **⏱ Timeout (60s)** | Switch to 60-second timeout and immediately start |
