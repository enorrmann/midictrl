import { useState, useEffect, useCallback, useRef } from 'react';

interface Port {
  id: string;
  client: string;
  name: string;
  type: string;
  connections: string[];
}

interface UnifiedClient {
  id: string;
  name: string;
  type: string;
  inputs: Port[]; // Senders (Node Outputs)
  outputs: Port[]; // Receivers (Node Inputs)
}

function DraggableNode({ id, title, type, ports, portType, position, onMove, onRef, selectedPorts = [], onSelectPort }: any) {
  const [isDragging, setIsDragging] = useState(false);
  const offset = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!(e.target as HTMLElement).closest('.node-header')) return;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    offset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    onMove(id, { x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const isSrc = portType === 'src';

  return (
    <div
      className="floating-node"
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="node-header">
        <div className="node-title">{title}</div>
        <div className="node-type">{type}</div>
      </div>
      
      <div className="node-body">
        <div className={isSrc ? "node-ports-out" : "node-ports-in"}>
          {ports.map((port: Port) => (
            <div 
              key={`${portType}-${port.id}`}
              className={`node-port ${isSrc ? 'src-port' : 'dest-port'} ${selectedPorts.includes(port.id) ? 'selected' : ''}`}
              ref={(el) => onRef(port.id, el, portType)}
              onClick={() => onSelectPort(port.id)}
            >
              {!isSrc && <div className="port-dot in-dot"></div>}
              <span>{port.id}: {port.name}</span>
              {isSrc && <div className="port-dot out-dot"></div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [clients, setClients] = useState<UnifiedClient[]>([]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    const saved = localStorage.getItem('nodePositions');
    return saved ? JSON.parse(saved) : {};
  });
  const [loading, setLoading] = useState(true);

  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedDests, setSelectedDests] = useState<string[]>([]);

  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number; active: boolean }[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const srcRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const destRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const API_BASE = 'http://localhost:3001/api';

  const fetchState = async () => {
    try {
      const res = await fetch(`${API_BASE}/state`);
      const data = await res.json();
      setClients(data);

      // Initialize missing positions
      setPositions((prev) => {
        const next = { ...prev };
        let changed = false;
        let index = 0;
        data.forEach((c: UnifiedClient) => {
          if (c.inputs.length > 0 && !next[`${c.id}-src`]) {
            next[`${c.id}-src`] = { x: 50 + (index % 3) * 300, y: 150 + Math.floor(index / 3) * 200 };
            changed = true;
            index++;
          }
          if (c.outputs.length > 0 && !next[`${c.id}-dest`]) {
            next[`${c.id}-dest`] = { x: 50 + (index % 3) * 300, y: 150 + Math.floor(index / 3) * 200 };
            changed = true;
            index++;
          }
        });
        if (changed) localStorage.setItem('nodePositions', JSON.stringify(next));
        return changed ? next : prev;
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleMoveNode = useCallback((id: string, newPos: { x: number; y: number }) => {
    setPositions((prev) => {
      const maxX = typeof window !== 'undefined' ? window.innerWidth - 100 : 2000;
      const maxY = typeof window !== 'undefined' ? window.innerHeight - 50 : 2000;
      const clampedX = Math.max(0, Math.min(newPos.x, maxX));
      const clampedY = Math.max(0, Math.min(newPos.y, maxY));
      
      const next = { ...prev, [id]: { x: clampedX, y: clampedY } };
      localStorage.setItem('nodePositions', JSON.stringify(next));
      return next;
    });
  }, []);

  const handleRef = useCallback((id: string, el: HTMLDivElement | null, type: 'src' | 'dest') => {
    if (type === 'src') srcRefs.current[id] = el;
    else destRefs.current[id] = el;
  }, []);

  const updateLines = useCallback(() => {
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const newLines = [];

    for (const client of clients) {
      for (const srcPort of client.inputs) {
        const srcEl = srcRefs.current[srcPort.id];
        if (!srcEl) continue;

        for (const destId of srcPort.connections) {
          const destEl = destRefs.current[destId];
          if (!destEl) continue;

          const srcRect = srcEl.getBoundingClientRect();
          const destRect = destEl.getBoundingClientRect();

          const srcDot = srcEl.querySelector('.out-dot');
          const destDot = destEl.querySelector('.in-dot');

          let x1 = srcRect.right;
          let y1 = srcRect.top + srcRect.height / 2;
          let x2 = destRect.left;
          let y2 = destRect.top + destRect.height / 2;

          if (srcDot) {
            const r = srcDot.getBoundingClientRect();
            x1 = r.left + r.width / 2;
            y1 = r.top + r.height / 2;
          }
          if (destDot) {
            const r = destDot.getBoundingClientRect();
            x2 = r.left + r.width / 2;
            y2 = r.top + r.height / 2;
          }

          x1 -= containerRect.left;
          y1 -= containerRect.top;
          x2 -= containerRect.left;
          y2 -= containerRect.top;

          const active = selectedSources.includes(srcPort.id) || selectedDests.includes(destId);
          newLines.push({ x1, y1, x2, y2, active });
        }
      }
    }
    setLines(newLines);
  }, [clients, positions, selectedSources, selectedDests]);

  useEffect(() => {
    requestAnimationFrame(updateLines);
  }, [updateLines]);

  const handleAction = async (action: 'connect' | 'disconnect') => {
    if (action === 'connect') {
      if (selectedSources.length === 0 || selectedDests.length === 0) return;
      try {
        for (const src of selectedSources) {
          for (const dest of selectedDests) {
            await fetch(`${API_BASE}/connect`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ src, dest }),
            });
          }
        }
        fetchState();
        setSelectedSources([]);
        setSelectedDests([]);
      } catch (e) {
        console.error(e);
      }
      return;
    }

    if (action === 'disconnect') {
      if (selectedSources.length === 0 && selectedDests.length === 0) return;
      try {
        if (selectedSources.length > 0 && selectedDests.length > 0) {
          // Disconnect explicitly selected pairs
          for (const src of selectedSources) {
            for (const dest of selectedDests) {
              await fetch(`${API_BASE}/disconnect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ src, dest }),
              });
            }
          }
        } else if (selectedSources.length > 0) {
          // Only sources selected: disconnect everything connected to them
          for (const srcId of selectedSources) {
            const client = clients.find(c => c.inputs.some(p => p.id === srcId));
            if (client) {
              const port = client.inputs.find(p => p.id === srcId);
              if (port) {
                for (const destId of port.connections) {
                  await fetch(`${API_BASE}/disconnect`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ src: srcId, dest: destId }),
                  });
                }
              }
            }
          }
        } else if (selectedDests.length > 0) {
          // Only destinations selected: disconnect everything connected to them
          for (const destId of selectedDests) {
            for (const client of clients) {
              for (const port of client.inputs) {
                if (port.connections.includes(destId)) {
                  await fetch(`${API_BASE}/disconnect`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ src: port.id, dest: destId }),
                  });
                }
              }
            }
          }
        }
        fetchState();
        setSelectedSources([]);
        setSelectedDests([]);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleDisconnectAll = async () => {
    try {
      await fetch(`${API_BASE}/disconnect-all`, { method: 'POST' });
      fetchState();
      setSelectedSources([]);
      setSelectedDests([]);
    } catch (e) {
      console.error(e);
    }
  };

  const handleRearrange = () => {
    setPositions(() => {
      const next: Record<string, { x: number; y: number }> = {};
      let index = 0;
      clients.forEach((c) => {
        if (c.inputs.length > 0) {
          next[`${c.id}-src`] = { x: 50 + (index % 3) * 300, y: 150 + Math.floor(index / 3) * 200 };
          index++;
        }
        if (c.outputs.length > 0) {
          next[`${c.id}-dest`] = { x: 50 + (index % 3) * 300, y: 150 + Math.floor(index / 3) * 200 };
          index++;
        }
      });
      localStorage.setItem('nodePositions', JSON.stringify(next));
      return next;
    });
  };

  const toggleSource = (id: string) => setSelectedSources(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleDest = (id: string) => setSelectedDests(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  if (loading) return <div className="loading">Loading Nodes...</div>;

  return (
    <div className="canvas-app" ref={containerRef}>
      <div className="canvas-toolbar">
        <h1 className="title">ALSA Graph</h1>
        <div className="canvas-controls">
          <button className="btn" onClick={handleRearrange}>Rearrange</button>
          <button className="btn" onClick={() => handleAction('connect')}>Connect</button>
          <button className="btn" onClick={() => handleAction('disconnect')}>Disconnect</button>
          <button className="btn btn-danger" onClick={handleDisconnectAll}>Disconnect All</button>
        </div>
      </div>

      <svg className="canvas-svg">
        {lines.map((line, i) => {
          const dx = Math.max(Math.abs(line.x2 - line.x1) * 0.5, 50);
          const path = `M ${line.x1} ${line.y1} C ${line.x1 + dx} ${line.y1}, ${line.x2 - dx} ${line.y2}, ${line.x2} ${line.y2}`;
          return (
            <path
              key={i}
              d={path}
              className={`svg-bezier ${line.active ? 'active' : ''}`}
            />
          );
        })}
      </svg>

      <div className="nodes-container">
        {clients.flatMap((c) => {
          const nodes = [];
          if (c.inputs.length > 0) {
            nodes.push(
              <DraggableNode
                key={`${c.id}-src`}
                id={`${c.id}-src`}
                title={`${c.id}: ${c.name} (Out)`}
                type={c.type}
                ports={c.inputs}
                portType="src"
                position={positions[`${c.id}-src`] || { x: 0, y: 0 }}
                onMove={handleMoveNode}
                onRef={handleRef}
                selectedPorts={selectedSources}
                onSelectPort={toggleSource}
              />
            );
          }
          if (c.outputs.length > 0) {
            nodes.push(
              <DraggableNode
                key={`${c.id}-dest`}
                id={`${c.id}-dest`}
                title={`${c.id}: ${c.name} (In)`}
                type={c.type}
                ports={c.outputs}
                portType="dest"
                position={positions[`${c.id}-dest`] || { x: 0, y: 0 }}
                onMove={handleMoveNode}
                onRef={handleRef}
                selectedPorts={selectedDests}
                onSelectPort={toggleDest}
              />
            );
          }
          return nodes;
        })}
      </div>
    </div>
  );
}

export default App;
