const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAconnectList } = require('../src/alsa');

test('parseAconnectList keeps all ports from a client', () => {
  const output = `client 28: 'MIDIMATE II' [type=kernel,card=3]
    0 'MIDIMATE II MIDI 1'
    1 'MIDIMATE II MIDI 2'`;

  const clients = parseAconnectList(output);
  assert.equal(clients.length, 1);
  assert.deepEqual(clients[0].ports.map((port) => port.portNum), ['0', '1']);
  assert.equal(clients[0].ports[1].name, 'MIDIMATE II MIDI 2');
});
