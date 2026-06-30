import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { ChildProcess } from 'child_process';

const execAsync = promisify(exec);

export interface Port {
    id: string;        // e.g. "hw:1,0,0"
    client: string;    // e.g. "hw:1"
    name: string;      // e.g. "USB MIDI Interface"
    type: string;      // always "rawmidi"
    connections: string[];
}

export interface UnifiedClient {
    id: string;
    name: string;
    type: string;
    inputs: Port[];   // ports that can send MIDI (IO or I)
    outputs: Port[];  // ports that can receive MIDI (IO or O)
}

// In-memory routing table: "srcId->destId" -> { reader, writer } child processes
interface Route {
    reader: ChildProcess;
    writer: ChildProcess;
}
const activeRoutes = new Map<string, Route>();

/**
 * Parse `amidi -l` output.
 * Example line:
 *   IO  hw:1,0,0    USB MIDI Interface MIDI 1
 *   I   hw:2,0,0    Some Input Only Port
 */
export function parseAmidiList(output: string): { id: string; dir: string; name: string }[] {
    const ports: { id: string; dir: string; name: string }[] = [];
    const lines = output.split('\n');
    for (const line of lines) {
        // Skip header line
        if (line.trim().startsWith('Dir') || line.trim() === '') continue;
        // Match: DIR  hw:X,Y,Z   Name
        const m = line.match(/^([IO]+)\s+(hw:\S+)\s+(.+)$/);
        if (m) {
            ports.push({ dir: m[1].trim(), id: m[2].trim(), name: m[3].trim() });
        }
    }
    return ports;
}

export async function getAlsaState(): Promise<UnifiedClient[]> {
    let stdout = '';
    try {
        const result = await execAsync('amidi -l');
        stdout = result.stdout;
    } catch (err: any) {
        // amidi -l might exit with non-zero if no devices
        stdout = err.stdout || '';
    }

    const rawPorts = parseAmidiList(stdout);

    // Group ports by hardware card (hw:X) to form "clients"
    const clientMap = new Map<string, { name: string; inputs: Port[]; outputs: Port[] }>();

    for (const rp of rawPorts) {
        // Client key = hw:X (first part before ,)
        const clientKey = rp.id.split(',')[0];

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

        // I = input-capable (can send MIDI out), O = output-capable (can receive MIDI)
        // IO = bidirectional → appears in both
        if (rp.dir.includes('I')) client.inputs.push(port);
        if (rp.dir.includes('O')) client.outputs.push(port);
    }

    const unified: UnifiedClient[] = [];
    for (const [id, c] of clientMap) {
        if (c.inputs.length > 0 || c.outputs.length > 0) {
            unified.push({
                id,
                name: c.name,
                type: 'rawmidi',
                inputs: c.inputs,
                outputs: c.outputs,
            });
        }
    }

    return unified;
}

export async function connectPorts(src: string, dest: string): Promise<void> {
    const key = `${src}->${dest}`;
    if (activeRoutes.has(key)) return; // already connected

    // amidi -p <src> -d  →  pipe raw bytes  →  amidi -p <dest> -s -
    const reader = spawn('amidi', ['-p', src, '-d'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const writer = spawn('amidi', ['-p', dest, '-s', '-'], { stdio: ['pipe', 'ignore', 'pipe'] });

    reader.stdout.pipe(writer.stdin);

    reader.on('error', (e) => console.error(`[amidi reader ${src}] error:`, e));
    writer.on('error', (e) => console.error(`[amidi writer ${dest}] error:`, e));
    reader.stderr.on('data', (d) => console.warn(`[amidi reader ${src}]:`, d.toString().trim()));
    writer.stderr.on('data', (d) => console.warn(`[amidi writer ${dest}]:`, d.toString().trim()));

    reader.on('exit', (code) => {
        console.log(`[amidi reader ${src}] exited with code ${code}`);
        activeRoutes.delete(key);
    });

    activeRoutes.set(key, { reader, writer });
    console.log(`Connected: ${src} → ${dest}`);
}

export async function disconnectPorts(src: string, dest: string): Promise<void> {
    const key = `${src}->${dest}`;
    const route = activeRoutes.get(key);
    if (!route) return;

    if (route.reader.stdout && route.writer.stdin) {
        route.reader.stdout.unpipe(route.writer.stdin);
    }
    route.reader.kill('SIGTERM');
    route.writer.kill('SIGTERM');
    activeRoutes.delete(key);
    console.log(`Disconnected: ${src} → ${dest}`);
}

export async function disconnectAll(): Promise<void> {
    for (const [, route] of activeRoutes) {
        if (route.reader.stdout && route.writer.stdin) {
            route.reader.stdout.unpipe(route.writer.stdin);
        }
        route.reader.kill('SIGTERM');
        route.writer.kill('SIGTERM');
    }
    activeRoutes.clear();
    console.log('All routes disconnected.');
}
