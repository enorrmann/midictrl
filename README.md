# MIDI Ctrl - ALSA Web Frontend

A modern web interface to manage ALSA MIDI connections on Linux. It provides a beautiful dashboard to view, connect, and disconnect MIDI inputs and outputs natively via `aconnect`.

## Features
- **Real-Time State:** Automatically fetches ALSA MIDI state from the system.
- **Visual Connections:** Click a source port to see which destinations it is connected to.
- **Easy Routing:** Connect/disconnect ports by selecting a source and then clicking a destination.
- **One-Click Disconnect All:** A single button to clear all current MIDI routings.
- **Responsive Design:** A beautiful dark-themed interface crafted with vanilla CSS.

## Architecture

This project consists of two parts:
1. **Backend (`/backend`)**: A Node.js Express server that interfaces directly with Linux's `aconnect` utility to parse device state and execute connection commands.
2. **Frontend (`/frontend`)**: A React (Vite) application that displays the dashboard and communicates with the REST API.

## Requirements
- **Linux** (e.g., Armbian 13)
- **ALSA and aconnect**: Typically pre-installed on Linux distributions with ALSA (`alsa-utils`).
- **Node.js**: v18+ recommended.

## Installation

```bash
# Clone the repository (if you haven't already)
git clone <your-repo> midictrl
cd midictrl

# Install dependencies for both backend and frontend
npm run install:all
```

## Running the Application

### Development
Run both the backend and frontend concurrently with hot-reloading:

```bash
npm run dev
```

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3001/api/state

### Production Build
To build the project for production:

```bash
npm run build
```

Then you can serve the frontend statically using a web server (like Nginx) and start the backend using `node backend/dist/index.js` or via PM2 on your Armbian system.

## API Endpoints

- `GET /api/state`: Returns an array of ALSA clients and their connected ports.
- `POST /api/connect`: Expects `{ "src": "id", "dest": "id" }`. Connects two ports.
- `POST /api/disconnect`: Expects `{ "src": "id", "dest": "id" }`. Disconnects two ports.
- `POST /api/disconnect-all`: Clears all connections using `aconnect -x`.
