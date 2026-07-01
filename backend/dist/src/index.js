"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const alsa_1 = require("./alsa");
const app = (0, express_1.default)();
const port = 3001;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.get('/api/state', async (req, res) => {
    try {
        const state = await (0, alsa_1.getAlsaState)();
        res.json(state);
    }
    catch (error) {
        console.error('Error fetching ALSA state:', error);
        res.status(500).json({ error: 'Failed to fetch ALSA state' });
    }
});
app.post('/api/connect', async (req, res) => {
    const { src, dest } = req.body;
    if (!src || !dest) {
        return res.status(400).json({ error: 'Missing src or dest' });
    }
    try {
        await (0, alsa_1.connectPorts)(src, dest);
        res.json({ success: true });
    }
    catch (error) {
        console.error(`Error connecting ${src} to ${dest}:`, error);
        res.status(500).json({ error: 'Failed to connect ports' });
    }
});
app.post('/api/disconnect', async (req, res) => {
    const { src, dest } = req.body;
    if (!src || !dest) {
        return res.status(400).json({ error: 'Missing src or dest' });
    }
    try {
        await (0, alsa_1.disconnectPorts)(src, dest);
        res.json({ success: true });
    }
    catch (error) {
        console.error(`Error disconnecting ${src} from ${dest}:`, error);
        res.status(500).json({ error: 'Failed to disconnect ports' });
    }
});
app.post('/api/disconnect-all', async (req, res) => {
    try {
        await (0, alsa_1.disconnectAll)();
        res.json({ success: true });
    }
    catch (error) {
        console.error('Error disconnecting all ports:', error);
        res.status(500).json({ error: 'Failed to disconnect all ports' });
    }
});
app.listen(port, '0.0.0.0', () => {
    console.log(`MIDI Ctrl backend listening on port ${port} (0.0.0.0)`);
});
