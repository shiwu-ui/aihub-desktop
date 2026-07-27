'use strict';

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const path = require('node:path');

class SidecarRpcError extends Error {
  constructor(message, code = 'SIDECAR_ERROR', data) {
    super(message);
    this.name = 'SidecarRpcError';
    this.code = code;
    this.data = data;
  }
}

class SidecarRpcClient extends EventEmitter {
  constructor(options = {}) {
    super();
    if (options.executablePath) throw new SidecarRpcError('Executable paths must be selected by executableId', 'PATH_NOT_ALLOWED');
    this.executableId = options.executableId;
    this.executableRegistry = options.executableRegistry || {};
    this.args = Array.isArray(options.args) ? options.args.slice() : [];
    this.cwd = options.cwd;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10000;
    this.stderrLimit = options.stderrLimit ?? 64 * 1024;
    this.stdoutBufferLimit = options.stdoutBufferLimit ?? 1024 * 1024;
    this._spawn = options.spawn || spawn;
    this._nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    this.buffer = '';
    this.process = null;
    this.started = false;
  }

  _resolveExecutable() {
    if (!this.executableId || typeof this.executableId !== 'string') throw new SidecarRpcError('executableId is required', 'EXECUTABLE_REQUIRED');
    const registered = Object.prototype.hasOwnProperty.call(this.executableRegistry, this.executableId);
    const value = registered ? this.executableRegistry[this.executableId] : null;
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new SidecarRpcError('Executable is not in the trusted absolute-path registry', 'PATH_NOT_ALLOWED');
    return value;
  }

  start() {
    if (this.process) return Promise.resolve(this);
    const executable = this._resolveExecutable();
    this.process = this._spawn(executable, this.args, { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.process.stdout.on('data', chunk => this._onStdout(chunk));
    this.process.stderr.on('data', chunk => {
      this.stderr = (this.stderr + chunk.toString()).slice(-this.stderrLimit);
      this.emit('stderr', chunk.toString());
    });
    this.process.once('error', error => this._failAll(new SidecarRpcError(error.message, 'PROCESS_ERROR')));
    this.process.once('close', (code, signal) => {
      this.started = false;
      this._failAll(new SidecarRpcError(`Sidecar exited (${code ?? 'null'}${signal ? `, ${signal}` : ''})`, 'PROCESS_EXIT'));
      this.emit('exit', { code, signal });
      this.process = null;
    });
    this.started = true;
    return Promise.resolve(this);
  }

  _onStdout(chunk) {
    this.buffer += chunk.toString();
    if (this.buffer.length > this.stdoutBufferLimit) {
      this.buffer = '';
      this.emit('protocolError', new SidecarRpcError('Sidecar output line exceeded the limit', 'OUTPUT_LIMIT'));
      return;
    }
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { this.emit('protocolError', new SidecarRpcError('Invalid NDJSON from sidecar', 'INVALID_JSON')); continue; }
      if (Object.prototype.hasOwnProperty.call(message, 'id')) {
        const entry = this.pending.get(message.id);
        if (!entry) continue;
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new SidecarRpcError(message.error.message || 'RPC error', message.error.code || 'RPC_ERROR', message.error.data));
        else entry.resolve(message.result);
      } else if (message.event || message.method) {
        const eventName = message.event || message.method;
        if (eventName === 'error') this.emit('protocolError', new SidecarRpcError('Reserved sidecar event name', 'RESERVED_EVENT'));
        else this.emit(eventName, message.params);
        this.emit('event', { event: eventName, params: message.params });
      }
    }
  }

  request(method, params, timeoutMs = this.requestTimeoutMs) {
    if (!this.process || !this.started) return Promise.reject(new SidecarRpcError('Sidecar is not running', 'NOT_STARTED'));
    const id = this._nextId++;
    const payload = { jsonrpc: '2.0', id, method };
    if (params !== undefined) payload.params = params;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SidecarRpcError(`RPC request timed out: ${method}`, 'TIMEOUT'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.process.stdin.write(JSON.stringify(payload) + '\n'); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  hello(params) { return this.request('hello', params); }
  version() { return this.request('version'); }
  capabilities() { return this.request('capabilities'); }
  subscribe(event, params) { return this.request('subscribe', { event, ...(params || {}) }); }

  _failAll(error) {
    for (const [, entry] of this.pending) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
  }

  async shutdown(timeoutMs = 1500) {
    if (!this.process) return;
    try { await this.request('shutdown', undefined, timeoutMs); } catch (_) { /* process may already be gone */ }
    if (this.process) await new Promise(resolve => {
      const timer = setTimeout(() => { this.kill(); resolve(); }, timeoutMs);
      this.process.once('close', () => { clearTimeout(timer); resolve(); });
    });
  }

  kill() {
    if (!this.process) return;
    try { this.process.kill(); } catch (_) { /* already exited */ }
    this._failAll(new SidecarRpcError('Sidecar killed', 'KILLED'));
  }
}

module.exports = { SidecarRpcClient, SidecarRpcError };
