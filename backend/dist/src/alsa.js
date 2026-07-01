"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAlsaState = getAlsaState;
exports.connectPorts = connectPorts;
exports.disconnectPorts = disconnectPorts;
exports.disconnectAll = disconnectAll;
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
function parseAconnectList(output) {
    const clients = [];
    let currentClient = null;
    let currentPort = null;
    for (const rawLine of output.split('\n')) {
        const line = rawLine;
        // Client line
        const clientMatch = line.match(/^client (\d+):\s+'([^']+)'\s+\[([^\]]*)\]/);
        if (clientMatch) {
            currentPort = null;
            currentClient = {
                id: clientMatch[1],
                name: clientMatch[2],
                type: clientMatch[3],
                ports: [],
            };
            clients.push(currentClient);
            continue;
        }
        if (!currentClient)
            continue;
        // Port line (starts with spaces then a digit)
        const portMatch = line.match(/^\s+(\d+)\s+'([^']+)'/);
        if (portMatch) {
            currentPort = {
                portNum: portMatch[1],
                name: portMatch[2].trim(),
                connectingTo: [],
                connectedFrom: [],
            };
            currentClient.ports.push(currentPort);
            continue;
        }
        if (!currentPort)
            continue;
        // Connection lines
        const connectingTo = line.match(/Connecting To:\s+(.+)/);
        if (connectingTo) {
            const targets = connectingTo[1].split(',').map(s => s.trim().split('[')[0].trim());
            currentPort.connectingTo.push(...targets);
        }
        const connectedFrom = line.match(/Connected From:\s+(.+)/);
        if (connectedFrom) {
            const sources = connectedFrom[1].split(',').map(s => s.trim().split('[')[0].trim());
            currentPort.connectedFrom.push(...sources);
        }
    }
    return clients;
}
// System clients to skip (they don't represent real devices)
const SKIP_CLIENTS = new Set(['0', '14']);
async function getAlsaState() {
    let stdout = '';
    try {
        const result = await execAsync('aconnect -l');
        stdout = result.stdout;
    }
    catch (err) {
        // aconnect exits with non-zero if no clients; stdout may still have data
        stdout = err.stdout || '';
        if (!stdout) {
            console.error('aconnect -l failed:', err.message);
        }
    }
    const rawClients = parseAconnectList(stdout);
    const unified = [];
    for (const rc of rawClients) {
        if (SKIP_CLIENTS.has(rc.id))
            continue;
        if (rc.ports.length === 0)
            continue;
        const inputs = [];
        const outputs = [];
        for (const rp of rc.ports) {
            const portId = `${rc.id}:${rp.portNum}`;
            // "inputs" = ports that produce MIDI (send MIDI out to other devices)
            // A port that has "Connecting To" entries is an output/sender
            // We expose ALL ports as both input and output (they are usually bidirectional)
            // but track connections separately.
            const portBase = {
                id: portId,
                client: rc.id,
                name: rp.name,
                type: 'sequencer',
            };
            // Source port (can send MIDI) - show outgoing connections
            inputs.push({
                ...portBase,
                connections: rp.connectingTo,
            });
            // Destination port (can receive MIDI) - show incoming connections
            outputs.push({
                ...portBase,
                connections: rp.connectedFrom,
            });
        }
        if (inputs.length > 0 || outputs.length > 0) {
            unified.push({
                id: rc.id,
                name: rc.name,
                type: rc.type,
                inputs,
                outputs,
            });
        }
    }
    return unified;
}
async function connectPorts(src, dest) {
    // src and dest are in "client:port" format, e.g. "24:0"
    try {
        await execAsync(`aconnect ${src} ${dest}`);
        console.log(`Connected: ${src} → ${dest}`);
    }
    catch (err) {
        const msg = err.stderr || err.message || String(err);
        // "Connection is already subscribed" is not a real error
        if (msg.includes('already subscribed')) {
            console.log(`Already connected: ${src} → ${dest}`);
            return;
        }
        throw new Error(`aconnect connect failed: ${msg}`);
    }
}
async function disconnectPorts(src, dest) {
    try {
        await execAsync(`aconnect -d ${src} ${dest}`);
        console.log(`Disconnected: ${src} → ${dest}`);
    }
    catch (err) {
        const msg = err.stderr || err.message || String(err);
        // "No subscription found" is not a real error
        if (msg.includes('No subscription') || msg.includes('not found')) {
            console.log(`Was not connected: ${src} → ${dest}`);
            return;
        }
        throw new Error(`aconnect disconnect failed: ${msg}`);
    }
}
async function disconnectAll() {
    try {
        await execAsync('aconnect -x');
        console.log('All connections removed via aconnect -x');
    }
    catch (err) {
        const msg = err.stderr || err.message || String(err);
        // May fail if there are no connections, that's fine
        console.warn('aconnect -x:', msg);
    }
}
