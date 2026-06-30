import express from 'express';
import cors from 'cors';
import { getAlsaState, connectPorts, disconnectPorts, disconnectAll } from './alsa';

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

app.get('/api/state', async (req, res) => {
    try {
        const state = await getAlsaState();
        res.json(state);
    } catch (error) {
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
        await connectPorts(src, dest);
        res.json({ success: true });
    } catch (error) {
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
        await disconnectPorts(src, dest);
        res.json({ success: true });
    } catch (error) {
        console.error(`Error disconnecting ${src} from ${dest}:`, error);
        res.status(500).json({ error: 'Failed to disconnect ports' });
    }
});

app.post('/api/disconnect-all', async (req, res) => {
    try {
        await disconnectAll();
        res.json({ success: true });
    } catch (error) {
        console.error('Error disconnecting all ports:', error);
        res.status(500).json({ error: 'Failed to disconnect all ports' });
    }
});

app.listen(port, () => {
    console.log(`MIDI Ctrl backend listening on port ${port}`);
});
