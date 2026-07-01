"use strict";
/**
 * alsa.ts – RawMIDI bridge backend.
 *
 * Enumeration: scan /dev/snd/midiC<N>D<M> directly and proactively probe
 * for additional ports per card.
 * Routing: stream bytes from one raw MIDI device to another.
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
exports.attachRouteConnections = attachRouteConnections;
exports.getAlsaState = getAlsaState;
exports.connectPorts = connectPorts;
exports.disconnectPorts = disconnectPorts;
exports.disconnectAll = disconnectAll;
const fs = __importStar(require("fs"));
const routes = new Map();
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
                .filter(([routeKey]) => routeKey.endsWith(`->${port.id}`))
                .map(([routeKey]) => routeKey.split('->')[0]);
            const uniqueConnections = Array.from(new Set([...port.connections, ...routeSources]));
            return { ...port, connections: uniqueConnections };
        });
        return { ...client, inputs: srcPorts, outputs: destPorts };
    });
}
async function getAlsaState() {
    const rawMidi = await scanRawMidi();
    return attachRouteConnections(rawMidi, routes);
}
async function scanRawMidi() {
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
    const allCards = new Set();
    // First, collect all existing device files
    let devs = [];
    try {
        devs = (await fs.promises.readdir('/dev/snd')).filter(f => /^midiC\d+D\d+$/.test(f));
    }
    catch {
        // no /dev/snd, proceed without it
    }
    for (const f of devs) {
        const m = f.match(/^midiC(\d+)D(\d+)$/);
        if (!m)
            continue;
        allCards.add(m[1]);
        if (!byCard.has(m[1]))
            byCard.set(m[1], []);
        byCard.get(m[1]).push(f);
    }
    // Also track cards from /proc/asound/cards
    for (const card of cardNames.keys()) {
        allCards.add(card);
    }
    // For each discovered card, proactively probe for ports up to D7
    for (const card of allCards) {
        if (!byCard.has(card))
            byCard.set(card, []);
        const cardDevs = byCard.get(card);
        for (let portNum = 0; portNum <= 7; portNum++) {
            const devPath = `/dev/snd/midiC${card}D${portNum}`;
            const devName = `midiC${card}D${portNum}`;
            // Skip if already found
            if (cardDevs.some(f => f.includes(`D${portNum}`)))
                continue;
            // Try to access the device
            try {
                await fs.promises.access(devPath, fs.constants.R_OK | fs.constants.W_OK);
                cardDevs.push(devName);
            }
            catch {
                // Device does not exist or is not accessible
            }
        }
    }
    const unified = [];
    for (const [card, files] of byCard) {
        if (files.length === 0)
            continue;
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
async function resolveDevPath(portId) {
    const rawM = portId.match(/^C(\d+)D(\d+)$/);
    if (rawM) {
        return `/dev/snd/midiC${rawM[1]}D${rawM[2]}`;
    }
    return null;
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
