import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface Port {
    id: string; // e.g. "14:0"
    client: string; // e.g. "Midi Through"
    name: string; // e.g. "Midi Through Port-0"
    type: string; // e.g. "kernel" or "user"
    connections: string[]; // List of port IDs this port connects to
}

export interface Client {
    id: string;
    name: string;
    type: string;
    ports: Port[];
}

export interface UnifiedClient {
    id: string;
    name: string;
    type: string;
    inputs: Port[];
    outputs: Port[];
}

export async function getAlsaState(): Promise<UnifiedClient[]> {
    const { stdout: stdoutI } = await execAsync('aconnect -i');
    const { stdout: stdoutO } = await execAsync('aconnect -o');
    const { stdout: stdoutL } = await execAsync('aconnect -l');

    const sourcesRef = parseAlsaOutput(stdoutI);
    const destsRef = parseAlsaOutput(stdoutO);
    const all = parseAlsaOutput(stdoutL);

    const unified: UnifiedClient[] = [];

    for (const c of all) {
        const sourceClient = sourcesRef.find(sc => sc.id === c.id);
        const destClient = destsRef.find(dc => dc.id === c.id);

        const inputs = sourceClient ? c.ports.filter(p => sourceClient.ports.some(sp => sp.id === p.id)) : [];
        const outputs = destClient ? c.ports.filter(p => destClient.ports.some(dp => dp.id === p.id)) : [];

        if (inputs.length > 0 || outputs.length > 0) {
            unified.push({
                id: c.id,
                name: c.name,
                type: c.type,
                inputs, // ALSA sources (midi outputs from the device)
                outputs // ALSA destinations (midi inputs to the device)
            });
        }
    }

    return unified;
}

export function parseAlsaOutput(output: string): Client[] {
    const clients: Client[] = [];
    let currentClient: Client | null = null;
    let currentPort: Port | null = null;

    const lines = output.split('\n');

    for (const line of lines) {
        const clientMatch = line.match(/^client (\d+):\s+'([^']+)'\s+\[type=(.+)\]/);
        if (clientMatch) {
            currentClient = {
                id: clientMatch[1],
                name: clientMatch[2],
                type: clientMatch[3].split(',')[0],
                ports: []
            };
            clients.push(currentClient);
            currentPort = null;
            continue;
        }

        const portMatch = line.match(/^\s+(\d+)\s+'([^']+)'/);
        if (portMatch && currentClient) {
            currentPort = {
                id: `${currentClient.id}:${portMatch[1]}`,
                client: currentClient.name,
                name: portMatch[2].trim(),
                type: currentClient.type,
                connections: []
            };
            currentClient.ports.push(currentPort);
            continue;
        }

        const connMatch = line.match(/^\s+Connecting To:\s+(.+)/);
        if (connMatch && currentPort) {
            const targets = connMatch[1].split(',').map(s => s.trim().split(' ')[0]); // sometimes it has [real: ...] stuff
            currentPort.connections.push(...targets);
            continue;
        }
        
        // We can ignore "Connected From:" because the connections graph can be built from "Connecting To:"
    }

    return clients;
}

export async function connectPorts(src: string, dest: string): Promise<void> {
    await execAsync(`aconnect ${src} ${dest}`);
}

export async function disconnectPorts(src: string, dest: string): Promise<void> {
    await execAsync(`aconnect -d ${src} ${dest}`);
}

export async function disconnectAll(): Promise<void> {
    await execAsync('aconnect -x');
}
