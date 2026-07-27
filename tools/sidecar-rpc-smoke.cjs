'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { SidecarRpcClient } = require('../src/sidecar-rpc.cjs');

function createMockSpawn() {
  const calls = [];
  const spawn = (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.stdin = new Writable({
      write(chunk, _encoding, done) {
        const message = JSON.parse(chunk.toString());
        if (message.method === 'never') return done();
        if (message.method === 'crash') { setImmediate(() => child.emit('close', 7, null)); return done(); }
        let result;
        if (message.method === 'hello') result = { name: 'cc-switch-sidecar', protocol: 1 };
        else if (message.method === 'version') result = '3.17.0';
        else if (message.method === 'capabilities') result = ['providers', 'config', 'events'];
        else if (message.method === 'subscribe') result = { subscribed: message.params.event };
        else if (message.method === 'shutdown') result = { ok: true };
        else result = message.params;
        setImmediate(() => {
          child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
          if (message.method === 'shutdown') setImmediate(() => child.emit('close', 0, null));
        });
        done();
      }
    });
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', null, 'SIGTERM')); return true; };
    return child;
  };
  return { spawn, calls };
}

async function main() {
  assert.throws(() => new SidecarRpcClient({ executablePath: 'C:\\evil.exe' }), /executableId/);
  assert.throws(() => new SidecarRpcClient({ executableId: 'missing', executableRegistry: {} }).start(), /trusted absolute-path/);
  assert.throws(() => new SidecarRpcClient({ executableId: 'toString', executableRegistry: {} }).start(), /trusted absolute-path/);

  const mock = createMockSpawn();
  const client = new SidecarRpcClient({
    executableId: 'cc-switch',
    executableRegistry: { 'cc-switch': 'C:\\Program Files\\AIHub\\cc-switch-sidecar.exe' },
    args: ['--stdio'], requestTimeoutMs: 30, stderrLimit: 12, spawn: mock.spawn
  });
  await client.start();
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].executable, 'C:\\Program Files\\AIHub\\cc-switch-sidecar.exe');
  assert.deepEqual(mock.calls[0].options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(mock.calls[0].options.windowsHide, true);

  assert.deepEqual(await client.hello({ client: 'aihub-desktop' }), { name: 'cc-switch-sidecar', protocol: 1 });
  assert.equal(await client.version(), '3.17.0');
  assert.deepEqual(await client.capabilities(), ['providers', 'config', 'events']);
  assert.deepEqual(await client.subscribe('provider.changed'), { subscribed: 'provider.changed' });

  const eventPromise = new Promise(resolve => client.once('provider.changed', resolve));
  client.process.stdout.write('{"event":"provider.changed",');
  client.process.stdout.write('"params":{"app":"codex"}}\n');
  assert.deepEqual(await eventPromise, { app: 'codex' });

  client.process.stderr.write('1234567890abcdef');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.stderr, '567890abcdef');

  await assert.rejects(client.request('never'), error => error.code === 'TIMEOUT');
  assert.equal(client.pending.size, 0);

  await client.shutdown(100);
  assert.equal(client.process, null);
  assert.equal(client.pending.size, 0);

  const killMock = createMockSpawn();
  const killClient = new SidecarRpcClient({ executableId: 'x', executableRegistry: { x: 'C:\\x.exe' }, spawn: killMock.spawn });
  await killClient.start();
  const pending = killClient.request('never', undefined, 1000);
  killClient.kill();
  await assert.rejects(pending, error => error.code === 'KILLED');
  assert.equal(killClient.pending.size, 0);

  const exitMock = createMockSpawn();
  const exitClient = new SidecarRpcClient({ executableId: 'x', executableRegistry: { x: 'C:\\x.exe' }, spawn: exitMock.spawn });
  await exitClient.start();
  await assert.rejects(exitClient.request('crash'), error => error.code === 'PROCESS_EXIT');
  assert.equal(exitClient.pending.size, 0);

  console.log('sidecar-rpc smoke: ok');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
