const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAconnectList, attachRouteConnections } = require('../src/alsa');

test('parseAconnectList keeps all ports from a client', () => {
  const output = `client 28: 'MIDIMATE II' [type=kernel,card=3]
    0 'MIDIMATE II MIDI 1'
    1 'MIDIMATE II MIDI 2'`;

  const clients = parseAconnectList(output);
  assert.equal(clients.length, 1);
  assert.deepEqual(clients[0].ports.map((port) => port.portNum), ['0', '1']);
  assert.equal(clients[0].ports[1].name, 'MIDIMATE II MIDI 2');
});

test('attachRouteConnections exposes active rawmidi routes', () => {
  const clients = [{
    id: '28',
    name: 'MIDIMATE II',
    type: 'kernel',
    inputs: [{ id: '28:0', client: '28', name: 'MIDIMATE II MIDI 1', type: 'rawmidi', connections: [] }],
    outputs: [{ id: '28:1', client: '28', name: 'MIDIMATE II MIDI 2', type: 'rawmidi', connections: [] }]
  }];

  const routes = new Map([['28:0->28:1', {}]]);
  const result = attachRouteConnections(clients, routes);

  assert.deepEqual(result[0].inputs[0].connections, ['28:1']);
  assert.deepEqual(result[0].outputs[0].connections, ['28:0']);
});
