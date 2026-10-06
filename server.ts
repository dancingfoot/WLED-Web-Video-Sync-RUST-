import express from 'express';
import path from 'path';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dgram from 'dgram';

// Override with PORT=3001 npm run dev when 3000 is already taken
const PORT = Number(process.env.PORT) || 3000;
const app = express();
const httpServer = http.createServer(app);

// Use a single UDP socket for all outgoing streams
const udpSocket = dgram.createSocket('udp4');

// Bind error handler to the UDP client to prevent system crashes
udpSocket.on('error', (err) => {
  console.error('UDP Socket error:', err.message);
});

// Art-Net sequence counter
let artnetSeq = 0;
let ddpSeq = 0;
let e131Seq = 0;

// Set up WebSocket server attached to the HTTP server
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected to WLED Video Sync WebSocket');

  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message);
      const { ip, port, protocol, pixels, universe } = data;

      if (!ip || !pixels || !Array.isArray(pixels)) return;

      const targetPort = Number(port) || (protocol === 'DDP' ? 4048 : protocol === 'Art-Net' ? 6454 : protocol === 'E1.31' ? 5568 : 21324);

      if (protocol === 'DDP') {
        // DDP Packet (10-byte header)
        // Supports automatic packet splitting for large pixel arrays
        const CHUNK_SIZE = 1440 * 3; // 4320 bytes max per packet
        const totalBytes = pixels.length;
        let offset = 0;

        while (offset < totalBytes) {
          const chunkLen = Math.min(totalBytes - offset, CHUNK_SIZE);
          const isLast = offset + chunkLen >= totalBytes;

          ddpSeq = (ddpSeq + 1) % 15;
          if (ddpSeq === 0) ddpSeq = 1;

          const ddpHeader = Buffer.alloc(10);
          ddpHeader.writeUInt8(isLast ? 0x41 : 0x01, 0); // Flags: Push on final packet
          ddpHeader.writeUInt8(ddpSeq, 1);
          ddpHeader.writeUInt8(0x01, 2); // Data type RGB
          ddpHeader.writeUInt8(0x01, 3); // Destination ID
          ddpHeader.writeUInt32BE(offset, 4); // Pixel offset
          ddpHeader.writeUInt16BE(chunkLen, 8); // Data length

          const chunkData = Buffer.from(pixels.slice(offset, offset + chunkLen));
          const buffer = Buffer.concat([ddpHeader, chunkData]);

          udpSocket.send(buffer, targetPort, ip, () => {});
          offset += chunkLen;
        }

      } else if (protocol === 'DRGB') {
        const header = Buffer.alloc(2);
        header.writeUInt8(0x02, 0);
        header.writeUInt8(0x02, 1); // 2 seconds timeout
        const rgbData = Buffer.from(pixels);
        udpSocket.send(Buffer.concat([header, rgbData]), targetPort, ip, () => {});

      } else if (protocol === 'WARLS') {
        const header = Buffer.alloc(2);
        header.writeUInt8(0x01, 0);
        header.writeUInt8(0x02, 1);

        const ledCount = Math.min(Math.floor(pixels.length / 3), 256);
        const warlsData = Buffer.alloc(ledCount * 4);
        for (let i = 0; i < ledCount; i++) {
          const outOffset = i * 4;
          const pxOffset = i * 3;
          warlsData.writeUInt8(i, outOffset);
          warlsData.writeUInt8(pixels[pxOffset], outOffset + 1);
          warlsData.writeUInt8(pixels[pxOffset + 1], outOffset + 2);
          warlsData.writeUInt8(pixels[pxOffset + 2], outOffset + 3);
        }
        udpSocket.send(Buffer.concat([header, warlsData]), targetPort, ip, () => {});

      } else if (protocol === 'Art-Net') {
        // Multi-universe Art-Net 4 slicing: 170 RGB LEDs = 510 channels per universe
        const CHANNELS_PER_UNIV = 170 * 3;
        const totalBytes = pixels.length;
        const startUniv = typeof universe === 'number' ? universe : 0;
        let offset = 0;
        let currentUniv = startUniv;

        while (offset < totalBytes) {
          const chunkLen = Math.min(totalBytes - offset, CHANNELS_PER_UNIV);
          const artHeader = Buffer.alloc(18);
          artnetSeq = (artnetSeq + 1) & 0xFF;
          if (artnetSeq === 0) artnetSeq = 1;

          artHeader.write('Art-Net\0', 0, 'ascii');
          artHeader.writeUInt16LE(0x5000, 8); // Opcode ArtDmx
          artHeader.writeUInt16BE(14, 10); // Proto Version
          artHeader.writeUInt8(artnetSeq, 12);
          artHeader.writeUInt8(0, 13);
          artHeader.writeUInt16LE(currentUniv, 14);
          artHeader.writeUInt16BE(chunkLen, 16);

          const dmxData = Buffer.from(pixels.slice(offset, offset + chunkLen));
          udpSocket.send(Buffer.concat([artHeader, dmxData]), targetPort, ip, () => {});

          offset += chunkLen;
          currentUniv = (currentUniv + 1) & 0x7FFF;
        }

      } else if (protocol === 'E1.31') {
        // Multi-universe sACN slicing: 170 RGB LEDs = 510 channels per universe
        const CHANNELS_PER_UNIV = 170 * 3;
        const totalBytes = pixels.length;
        const startUniv = typeof universe === 'number' ? universe : 1;
        let offset = 0;
        let currentUniv = startUniv;

        while (offset < totalBytes) {
          const chunkLen = Math.min(totalBytes - offset, CHANNELS_PER_UNIV);
          const e131Header = Buffer.alloc(126);
          e131Seq = (e131Seq + 1) & 0xFF;

          // Root Layer
          e131Header.writeUInt16BE(0x0010, 0);
          e131Header.writeUInt16BE(0x0000, 2);
          e131Header.write('ASC-E1.17\0\0\0', 4, 12, 'ascii');
          e131Header.writeUInt16BE(0x7000 | (110 + chunkLen), 16);
          e131Header.writeUInt32BE(0x00000004, 18);
          
          const cid = Buffer.from([0x2d, 0x8a, 0x48, 0x11, 0xe0, 0x9c, 0x4d, 0x9e, 0xb8, 0xd0, 0xa1, 0x58, 0xd4, 0x07, 0xf0, 0x36]);
          cid.copy(e131Header, 22);

          // Framing Layer
          e131Header.writeUInt16BE(0x7000 | (88 + chunkLen), 38);
          e131Header.writeUInt32BE(0x00000002, 40);
          e131Header.write('WLED Video Sync', 44, 64, 'ascii');
          e131Header.writeUInt8(100, 108);
          e131Header.writeUInt16BE(0x0000, 109);
          e131Header.writeUInt8(e131Seq, 111);
          e131Header.writeUInt8(0, 112);
          e131Header.writeUInt16BE(currentUniv, 113);

          // DMP Layer
          e131Header.writeUInt16BE(0x7000 | (11 + chunkLen), 115);
          e131Header.writeUInt8(0x02, 117);
          e131Header.writeUInt8(0xa1, 118);
          e131Header.writeUInt16BE(0x0000, 119);
          e131Header.writeUInt16BE(0x0001, 121);
          e131Header.writeUInt16BE(chunkLen + 1, 123);
          e131Header.writeUInt8(0x00, 125);

          const dmxData = Buffer.from(pixels.slice(offset, offset + chunkLen));
          udpSocket.send(Buffer.concat([e131Header, dmxData]), targetPort, ip, () => {});

          offset += chunkLen;
          currentUniv = (currentUniv + 1) & 0xFFFF;
        }
      }
    } catch {
      // Catch syntax errors or malformed frames safely
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected from WLED Video Sync WebSocket');
  });
});

// Handle WebSocket upgrade manually
httpServer.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

  if (pathname === '/api/video-sync') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    udpSocketActive: true,
    supportedProtocols: ['DDP', 'Art-Net', 'E1.31', 'WARLS', 'DRGB'],
    rustEngineAvailable: true
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    // Imported lazily so that 'vite' is a development-only runtime dependency
    // and is not required by the bundled production server.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Resolve relative to the compiled server file, not the working directory,
    // so the packaged app can be launched from anywhere.
    const distPath = __dirname;
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Start with PORT=<free port> to pick another.`);
    } else {
      console.error(`Server error: ${err.message}`);
    }
    process.exit(1);
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
