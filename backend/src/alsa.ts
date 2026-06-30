import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execAsync = promisify(exec);

export interface Port {
    id: string;        // e.g. "hw:1,0,0"
    client: string;    // e.g. "hw:1"
    name: string;      // e.g. "USB MIDI Interface"
    type: string;
    connections: string[];
}

export interface UnifiedClient {
    id: string;
    name: string;
    type: string;
    inputs: Port[];   // ports that can produce MIDI (readable, dir includes 'I')
    outputs: Port[];  // ports that can consume MIDI (writable, dir includes 'O')
}

interface Route {
    readStream: fs.ReadStream;
    writeStream: fs.WriteStream;
}

const activeRoutes = new Map<string, Route>();

/**
 * Convert "hw:X,Y,Z" to "/dev/snd/midiCXDY"
 * (subdevice Z is not part of the path; it's selected by open order)
 */
function hwToDevPath(hw: string): string {
    const m = hw.match(/^hw:(\d+),(\d+)/);
    if (!m) throw new Error(`Invalid hw port: ${hw}`);
    return `/dev/snd/midiC${m[1]}D${m[2]}`;
}

/**
 * Parse `amidi -l` output.
 * Example:
 *   Dir Device    Name
 *   IO  hw:1,0,0  USB MIDI Interface MIDI 1
 */
function parseAmidiList(output: string): { id: string; dir: string; name: string }[] {
    const ports: { id: string; dir: string; name: string }[] = [];
    for (const line of output.split('\n')) {
        if (line.trim().startsWith('Dir') || line.trim() === '') continue;
        const m = line.match(/^([IO]+)\s+(hw:\S+)\s+(.+)$/);
        if (m) ports.push({ dir: m[1].trim(), id: m[2].trim(), name: m[3].trim() });
    }
    return ports;
}

export async function getAlsaState(): Promise<UnifiedClient[]> {
    let stdout = '';
    try {
        const result = await execAsync('amidi -l');
        stdout = result.stdout;
    } catch (err: any) {
        stdout = err.stdout || '';
    }

    const rawPorts = parseAmidiList(stdout);
    const clientMap = new Map<string, { name: string; inputs: Port[]; outputs: Port[] }>();

    for (const rp of rawPorts) {
        const clientKey = rp.id.split(',')[0]; // hw:X

        if (!clientMap.has(clientKey)) {
            clientMap.set(clientKey, { name: rp.name, inputs: [], outputs: [] });
        }
        const client = clientMap.get(clientKey)!;

        // Build connection list from active routes
        const connections: string[] = [];
        for (const [key] of activeRoutes) {
            const [src, dest] = key.split('->');
            if (src === rp.id) connections.push(dest);
        }

        const port: Port = {
            id: rp.id,
            client: clientKey,
            name: rp.name,
            type: 'rawmidi',
            connections,
        };

        // 'I' = can produce MIDI (source), 'O' = can consume MIDI (destination)
        if (rp.dir.includes('I')) client.inputs.push(port);
        if (rp.dir.includes('O')) client.outputs.push(port);
    }

    const unified: UnifiedClient[] = [];
    for (const [id, c] of clientMap) {
        if (c.inputs.length > 0 || c.outputs.length > 0) {
            unified.push({ id, name: c.name, type: 'rawmidi', inputs: c.inputs, outputs: c.outputs });
        }
    }

    return unified;
}

export async function connectPorts(src: string, dest: string): Promise<void> {
    const key = `${src}->${dest}`;
    if (activeRoutes.has(key)) return;

    const srcPath = hwToDevPath(src);
    const destPath = hwToDevPath(dest);

    const readStream = fs.createReadStream(srcPath);
    const writeStream = fs.createWriteStream(destPath);

    // Handle errors without crashing the process
    readStream.on('error', (e) => {
        console.error(`[midi read ${src}] error:`, e.message);
        disconnectPorts(src, dest).catch(() => {});
    });
    writeStream.on('error', (e) => {
        console.error(`[midi write ${dest}] error:`, e.message);
        disconnectPorts(src, dest).catch(() => {});
    });

    readStream.pipe(writeStream);
    activeRoutes.set(key, { readStream, writeStream });
    console.log(`Connected: ${src} (${srcPath}) → ${dest} (${destPath})`);
}

export async function disconnectPorts(src: string, dest: string): Promise<void> {
    const key = `${src}->${dest}`;
    const route = activeRoutes.get(key);
    if (!route) return;

    route.readStream.unpipe(route.writeStream);
    route.readStream.destroy();
    route.writeStream.destroy();
    activeRoutes.delete(key);
    console.log(`Disconnected: ${src} → ${dest}`);
}

export async function disconnectAll(): Promise<void> {
    for (const [, route] of activeRoutes) {
        route.readStream.unpipe(route.writeStream);
        route.readStream.destroy();
        route.writeStream.destroy();
    }
    activeRoutes.clear();
    console.log('All routes disconnected.');
}
