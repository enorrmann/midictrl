"use strict";
/**
 * alsa.ts – RawMIDI bridge backend.
 *
 * Enumeration prefers ALSA client/port information from aconnect when available,
 * then falls back to direct /dev/snd/midiC<N>D<M> discovery for raw routing.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAconnectList = parseAconnectList;
exports.attachRouteConnections = attachRouteConnections;
exports.getAlsaState = getAlsaState;
exports.connectPorts = connectPorts;
exports.disconnectPorts = disconnectPorts;
exports.disconnectAll = disconnectAll;
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
const routes = new Map();
const clientCard = new Map();
const SKIP = new Set(['0', '14']);
function parseAconnectList(output) {
    const clients = [];
    let currentClient = null;
    let currentPort = null;
    for (const rawLine of output.split('\n')) {
        const line = rawLine.trimEnd();
        const clientMatch = line.match(/^client\s+(\d+):\s+'([^']+)'\s+\[([^\]]*)\]/);
        if (clientMatch) {
            currentPort = null;
            currentClient = {
                id: clientMatch[1],
                name: clientMatch[2],
                type: clientMatch[3],
                ports: []
            };
            clients.push(currentClient);
            continue;
        }
        if (!currentClient)
            continue;
        const portMatch = line.match(/^\s+(\d+)\s+'([^']+)'/);
        if (portMatch) {
            currentPort = {
                portNum: portMatch[1],
                name: portMatch[2].trim(),
                connectingTo: [],
                connectedFrom: []
            };
            currentClient.ports.push(currentPort);
            continue;
        }
        if (!currentPort)
            continue;
        const connectingTo = line.match(/^\s+Connecting To:\s+(.+)$/);
        if (connectingTo) {
            currentPort.connectingTo = connectingTo[1]
                .split(',')
                .map(item => item.trim())
                .filter(Boolean);
            continue;
        }
        const connectedFrom = line.match(/^\s+Connected From:\s+(.+)$/);
        if (connectedFrom) {
            currentPort.connectedFrom = connectedFrom[1]
                .split(',')
                .map(item => item.trim())
                .filter(Boolean);
        }
    }
    return clients;
}
async function resolveDevPath(portId) {
    const rawM = portId.match(/^C(\d+)D(\d+)$/);
    if (rawM) {
        return `/dev/snd/midiC${rawM[1]}D${rawM[2]}`;
    }
    const seqM = portId.match(/^(\d+):(\d+)$/);
    if (seqM) {
        const card = clientCard.get(seqM[1]);
        if (card !== undefined) {
            const candidates = [
                `/dev/snd/midiC${card}D${seqM[2]}`,
                `/dev/snd/midiC${card}D0`,
                `/dev/snd/midiC${card}D1`
            ];
            for (const candidate of candidates) {
                try {
                    await fs.promises.access(candidate, fs.constants.R_OK | fs.constants.W_OK);
                    return candidate;
                }
                catch {
                    // try the next candidate
                }
            }
        }
    }
    return null;
}
function toUnifiedClients(rawClients) {
    clientCard.clear();
    const unified = [];
    for (const rc of rawClients) {
        if (SKIP.has(rc.id))
            continue;
        const cardMatch = rc.type.match(/card=(\d+)/);
        if (cardMatch)
            clientCard.set(rc.id, cardMatch[1]);
        const inputs = [];
        const outputs = [];
        for (const rp of rc.ports) {
            const pid = `${rc.id}:${rp.portNum}`;
            const base = {
                id: pid,
                client: rc.id,
                name: rp.name,
                type: 'rawmidi'
            };
            inputs.push({ ...base, connections: rp.connectingTo });
            outputs.push({ ...base, connections: rp.connectedFrom });
        }
        if (inputs.length || outputs.length) {
            unified.push({ id: rc.id, name: rc.name, type: rc.type, inputs, outputs });
        }
    }
    return unified;
}
function attachRouteConnections(clients, routeMap) {
    return clients.map(client => {
        const srcPorts = client.inputs.map(port => {
            const routeTargets = [...routeMap.entries()]
                .filter(([routeKey]) => routeKey.startsWith(`${port.id}->`))
                .map(([routeKey]) => routeKey.split('->')[1]);
            const uniqueConnections = Array.from(new Set([...port.connections, ...routeTargets]));
            return { ...port, connections: uniqueConnections };
        });
        const destPorts = client.outputs.map(port => {
            const routeSources = [...routeMap.entries()]
                .filter(([key]) => key.endsWith(`->${port.id}`))
                .map(([key]) => key.split('->')[0]);
            const uniqueConnections = Array.from(new Set([...port.connections, ...routeSources]));
            return { ...port, connections: uniqueConnections };
        });
        return { ...client, inputs: srcPorts, outputs: destPorts };
    });
}
async function listFromAconnect() {
    try {
        const { stdout } = await execFileAsync('aconnect', ['-l'], { encoding: 'utf8' });
        return toUnifiedClients(parseAconnectList(stdout));
    }
    catch (error) {
        if (error && typeof error === 'object' && 'stdout' in error) {
            const stdout = String(error.stdout ?? '');
            if (stdout) {
                return toUnifiedClients(parseAconnectList(stdout));
            }
        }
        return null;
    }
}
async function getAlsaState() {
    const fromAconnect = await listFromAconnect();
    if (fromAconnect && fromAconnect.length > 0) {
        return attachRouteConnections(fromAconnect, routes);
    }
    const rawMidi = await scanRawMidi();
    return attachRouteConnections(rawMidi, routes);
}
async function scanRawMidi() {
    let devs = [];
    try {
        devs = (await fs.promises.readdir('/dev/snd')).filter(f => /^midiC\d+D\d+$/.test(f));
    }
    catch {
        return [];
    }
    const cardNames = new Map();
    try {
        for (const line of (await fs.promises.readFile('/proc/asound/cards', 'utf8')).split('\n')) {
            const m = line.match(/^\s*(\d+)\s+\[[^\]]+\]:\s+\S+\s+-\s+(.+)$/);
            if (m)
                cardNames.set(m[1], m[2].trim());
        }
    }
    catch {
        // ignore missing card names
    }
    const byCard = new Map();
    for (const f of devs) {
        const m = f.match(/^midiC(\d+)D(\d+)$/);
        if (!m)
            continue;
        if (!byCard.has(m[1]))
            byCard.set(m[1], []);
        byCard.get(m[1]).push(f);
    }
    const unified = [];
    for (const [card, files] of byCard) {
        const name = cardNames.get(card) ?? `Card ${card}`;
        const inputs = [];
        const outputs = [];
        for (const f of files.sort()) {
            const m = f.match(/^midiC(\d+)D(\d+)$/);
            const pid = `C${card}D${m[2]}`;
            const base = { id: pid, client: `C${card}`, name: `${name} MIDI ${m[2]}`, type: 'rawmidi' };
            const outConns = [...routes.keys()].filter(k => k.startsWith(`${pid}->`)).map(k => k.split('->')[1]);
            const inConns = [...routes.keys()].filter(k => k.endsWith(`->${pid}`)).map(k => k.split('->')[0]);
            inputs.push({ ...base, connections: outConns });
            outputs.push({ ...base, connections: inConns });
        }
        unified.push({ id: `C${card}`, name, type: 'rawmidi', inputs, outputs });
    }
    return unified;
}
async function connectPorts(src, dest) {
    const key = `${src}->${dest}`;
    if (routes.has(key))
        return;
    const srcDev = await resolveDevPath(src);
    const destDev = await resolveDevPath(dest);
    if (!srcDev || !destDev) {
        throw new Error(`No raw MIDI device for ${src}→${dest}. ` +
            `srcDev=${srcDev ?? 'none'}, destDev=${destDev ?? 'none'}.`);
    }
    const reader = fs.createReadStream(srcDev);
    const writer = fs.createWriteStream(destDev);
    const cleanup = () => disconnectPorts(src, dest).catch(() => { });
    reader.on('error', error => {
        console.error(`[midi read ${src}]`, error.message);
        cleanup();
    });
    writer.on('error', error => {
        console.error(`[midi write ${dest}]`, error.message);
        cleanup();
    });
    reader.pipe(writer);
    routes.set(key, { reader, writer });
    console.log(`[midi] Connected: ${src} (${srcDev}) → ${dest} (${destDev})`);
}
async function disconnectPorts(src, dest) {
    const key = `${src}->${dest}`;
    const route = routes.get(key);
    if (!route)
        return;
    route.reader.unpipe(route.writer);
    route.reader.destroy();
    route.writer.destroy();
    routes.delete(key);
    console.log(`[midi] Disconnected: ${src} → ${dest}`);
}
async function disconnectAll() {
    for (const route of routes.values()) {
        route.reader.unpipe(route.writer);
        route.reader.destroy();
        route.writer.destroy();
    }
    routes.clear();
    console.log('[midi] All routes disconnected.');
}
