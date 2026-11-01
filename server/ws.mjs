// Minimal RFC 6455 WebSocket server implementation (server side only, zero deps).
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_CONT = 0x0, OP_TEXT = 0x1, OP_BINARY = 0x2, OP_CLOSE = 0x8, OP_PING = 0x9, OP_PONG = 0xA;
const MAX_MESSAGE = 1 << 20; // 1 MiB

function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const header = [0x80 | opcode];
  let offset = 0;
  if (data.length < 126) {
    header.push(data.length);
    offset = 2;
  } else if (data.length < 65536) {
    header.push(126, (data.length >> 8) & 0xff, data.length & 0xff);
    offset = 4;
  } else {
    const len = data.length;
    header.push(127);
    for (let i = 7; i >= 0; i--) header.push(Math.floor(len / 2 ** (8 * i)) & 0xff);
    offset = 10;
  }
  return Buffer.concat([Buffer.from(header), data], offset + data.length);
}

export class WebSocketConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragOpcode = -1;
    this.ip = socket.remoteAddress || '';
    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('error', () => this._close());
    socket.on('close', () => this.emit('close'));
  }
  _onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.buffer.length >= 2) {
      const consumed = this._parseFrame();
      if (consumed === 0) break; // need more data
      this.buffer = this.buffer.subarray(consumed);
    }
  }
  _parseFrame() {
    const buf = this.buffer;
    const b0 = buf[0], b1 = buf[1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (buf.length < 4) return 0;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) return 0;
      const hi = buf.readUInt32BE(2), lo = buf.readUInt32BE(6);
      if (hi > 0x1ffff) { this._close(); return buf.length; }
      len = hi * 0x100000000 + lo;
      offset = 10;
    }
    if (len > MAX_MESSAGE) { this._close(); return buf.length; }
    const maskLen = masked ? 4 : 0;
    if (buf.length < offset + maskLen + len) return 0;
    let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
    if (masked) {
      const key = buf.subarray(offset, offset + 4);
      if (len > 0) {
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ key[i & 3];
        payload = out;
      }
    }
    const consumed = offset + maskLen + len;

    if (opcode === OP_PING) {
      this._sendRaw(encodeFrame(OP_PONG, payload));
    } else if (opcode === OP_PONG) {
      this.emit('pong');
    } else if (opcode === OP_CLOSE) {
      this._sendRaw(encodeFrame(OP_CLOSE, Buffer.alloc(0)));
      this._close();
    } else if (opcode === OP_TEXT || opcode === OP_BINARY || opcode === OP_CONT) {
      const isData = opcode !== OP_CONT;
      if (isData) this.fragments = [];
      this.fragments.push(payload);
      if (fin) {
        const msg = Buffer.concat(this.fragments);
        this.fragments = [];
        if (opcode === OP_TEXT) {
          this.emit('message', msg.toString('utf8'));
        } else {
          this.emit('message-binary', msg);
        }
      }
    }
    return consumed;
  }
  _sendRaw(buf) {
    if (this.socket && !this.socket.destroyed) this.socket.write(buf);
  }
  send(data) {
    this._sendRaw(encodeFrame(OP_TEXT, typeof data === 'string' ? data : JSON.stringify(data)));
  }
  ping() { this._sendRaw(encodeFrame(OP_PING, Buffer.alloc(0))); }
  _close() {
    if (this.socket && !this.socket.destroyed) this.socket.destroy();
  }
  close() { this._close(); }
}

export function acceptWebSocket(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    '\r\n'
  );
  return new WebSocketConnection(socket);
}