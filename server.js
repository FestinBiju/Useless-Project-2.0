const fs = require('fs');
const express = require('express');
const socketIo = require('socket.io');
const https = require('https');

// ---- SSL Certificate files ----
// Make sure cert/key.pem and cert/cert.pem exist
const sslOptions = {
  key: fs.readFileSync('./cert/key.pem'),
  cert: fs.readFileSync('./cert/cert.pem')
};

const app = express();
app.use(express.static(__dirname));

const server = https.createServer(sslOptions, app);
const io = socketIo(server, {
  maxHttpBufferSize: 1e7 // allow large audio chunks
});

let currentSpeaker = null;

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  socket.emit('channelStatus', { busy: !!currentSpeaker, speaker: currentSpeaker });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (currentSpeaker === socket.id) {
      currentSpeaker = null;
      io.emit('channelStatus', { busy: false, speaker: null });
    }
  });

  // Request to start talking
  socket.on('startTalking', (ack) => {
    if (!currentSpeaker || currentSpeaker === socket.id) {
      currentSpeaker = socket.id;
      io.emit('channelStatus', { busy: true, speaker: currentSpeaker });
      ack?.({ ok: true });
    } else {
      ack?.({ ok: false, reason: 'Channel busy' });
    }
  });

  // Stop talking
  socket.on('stopTalking', () => {
    if (currentSpeaker === socket.id) {
      currentSpeaker = null;
      io.emit('channelStatus', { busy: false, speaker: null });
    }
  });

  // Relay raw audio data
  socket.on('audioChunk', (data) => {
    console.log(`Received audio chunk from ${socket.id}, type: ${typeof data}, constructor: ${data?.constructor?.name}`);
    
    if (currentSpeaker === socket.id && data) {
      // Broadcast to all other clients except sender
      socket.broadcast.emit('audioChunk', data);
      console.log(`Broadcasting audio chunk to other clients`);
    } else if (currentSpeaker !== socket.id) {
      console.log(`Ignoring audio chunk from non-speaker: ${socket.id}`);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ HTTPS Server running at https://192.168.141.147:${PORT}`);
  console.log('⚠️  Accept the browser certificate warning to allow mic access.');
});
