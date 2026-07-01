const test = require('node:test');
const assert = require('node:assert/strict');
const { attachRouteConnections } = require('../src/alsa');

test('attachRouteConnections exposes active rawmidi routes', () => {
  const clients = [{
    id: '2',
    name: 'MIDIMATE II',
    type: 'rawmidi',
    inputs: [
      { id: 'C2D0', client: 'C2', name: 'MIDIMATE II MIDI 0', type: 'rawmidi', connections: [] },
      { id: 'C2D1', client: 'C2', name: 'MIDIMATE II MIDI 1', type: 'rawmidi', connections: [] }
    ],
    outputs: [
      { id: 'C2D0', client: 'C2', name: 'MIDIMATE II MIDI 0', type: 'rawmidi', connections: [] },
      { id: 'C2D1', client: 'C2', name: 'MIDIMATE II MIDI 1', type: 'rawmidi', connections: [] }
    ]
  }];

  const routes = new Map([['C2D0->C2D1', {}]]);
  const result = attachRouteConnections(clients, routes);

  assert.deepEqual(result[0].inputs[0].connections, ['C2D1']);
  assert.deepEqual(result[0].outputs[1].connections, ['C2D0']);
});
