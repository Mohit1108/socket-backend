const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const db = require('./firebase'); // Make sure this exports Firestore

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Socket.IO handlers
io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  // CREATE ROOM
  socket.on('room:create', async ({ code, userId, nickname, defaultVideo }) => {
    const newRoom = {
      id: socket.id,
      code,
      users: [{ id: userId, nickname, isHost: true }],
      videoQueue: defaultVideo ? [defaultVideo] : [],
      currentVideoIndex: defaultVideo ? 0 : -1,
      messages: [],
      playerState: {
        isPlaying: false,
        currentTime: 0,
        lastUpdated: Date.now()
      },
      settings: {
        waitForAll: false,
        allowGuestControl: true,
        isPrivate: false
      }
    };

    await db.collection('rooms').doc(code).set(newRoom);
    socket.join(code);
    console.log(`✅ Room ${code} created by ${nickname}`);
    io.to(socket.id).emit('room:created', newRoom);
  });

  // JOIN ROOM
  socket.on('room:join', async ({ code, userId, nickname }) => {
    const doc = await db.collection('rooms').doc(code).get();
    if (!doc.exists) {
      socket.emit('room:error', 'Room not found');
      return;
    }

    const room = doc.data();

    if (!room.users.find(u => u.id === userId)) {
      room.users.push({ id: userId, nickname, isHost: false });
      room.messages.push({
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        userId: 'system',
        nickname: 'System',
        text: `${nickname} joined the room!`,
        timestamp: Date.now(),
        isSystemMessage: true
      });
    }

    await db.collection('rooms').doc(code).set(room);
    socket.join(code);
    io.to(socket.id).emit('room:updated', room);
    socket.to(code).emit('room:updated', room);
  });

  // LEAVE ROOM
  socket.on('room:leave', async ({ roomId, userId }) => {
    const snap = await db.collection('rooms').where('id', '==', roomId).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const room = doc.data();

    room.users = room.users.filter(u => u.id !== userId);
    await db.collection('rooms').doc(room.code).set(room);
    socket.leave(room.code);
    io.to(room.code).emit('room:updated', room);
  });

  // ADD VIDEO
  socket.on('video:add', async ({ roomId, queueItem }) => {
    const snap = await db.collection('rooms').where('id', '==', roomId).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const room = doc.data();

    room.videoQueue.push(queueItem);
    if (room.currentVideoIndex === -1) {
      room.currentVideoIndex = 0;
      room.playerState = { isPlaying: true, currentTime: 0, lastUpdated: Date.now() };
    }

    await db.collection('rooms').doc(room.code).set(room);
    io.to(room.code).emit('room:updated', room);
  });

  // REMOVE VIDEO
  socket.on('video:remove', async ({ roomId, videoId }) => {
    const snap = await db.collection('rooms').where('id', '==', roomId).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const room = doc.data();

    room.videoQueue = room.videoQueue.filter(v => v.id !== videoId);
    await db.collection('rooms').doc(room.code).set(room);
    io.to(room.code).emit('room:updated', room);
  });

  // SKIP VIDEO
  socket.on('video:skip', async ({ roomId }) => {
    const snap = await db.collection('rooms').where('id', '==', roomId).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const room = doc.data();

    room.currentVideoIndex = room.currentVideoIndex < room.videoQueue.length - 1
      ? room.currentVideoIndex + 1
      : -1;

    await db.collection('rooms').doc(room.code).set(room);
    io.to(room.code).emit('room:updated', room);
  });

  // PLAY / PAUSE
  socket.on('video:playPause', async ({ roomId, isPlaying }) => {
    const snap = await db.collection('rooms').where('id', '==', roomId).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const room = doc.data();

    room.playerState.isPlaying = isPlaying;
    room.playerState.lastUpdated = Date.now();

    await db.collection('rooms').doc(room.code).set(room);
    io.to(room.code).emit('room:updated', room);
  });

  // SEEK
  socket.on('video:seek', async ({ roomId, time }) => {
    const snap = await db.collection('rooms').where('id', '==', roomId).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const room = doc.data();

    room.playerState.currentTime = time;
    room.playerState.lastUpdated = Date.now();

    await db.collection('rooms').doc(room.code).set(room);
    io.to(room.code).emit('room:updated', room);
  });

  // SEND MESSAGE
  socket.on('message:send', async ({ roomId, message }) => {
    const snap = await db.collection('rooms').where('id', '==', roomId).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const room = doc.data();

    room.messages.push(message);
    await db.collection('rooms').doc(room.code).set(room);
    io.to(room.code).emit('room:updated', room);
  });

  // SEND REACTION
  socket.on('reaction:send', ({ roomId, reaction }) => {
    io.to(roomId).emit('reaction:new', reaction);
  });

  // UPDATE NICKNAME
  socket.on('user:update', async ({ roomId, userId, nickname }) => {
    const snap = await db.collection('rooms').where('id', '==', roomId).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const room = doc.data();

    const user = room.users.find(u => u.id === userId);
    if (user) user.nickname = nickname;

    await db.collection('rooms').doc(room.code).set(room);
    io.to(room.code).emit('room:updated', room);
  });

  // UPDATE SETTINGS
  socket.on('room:updateSettings', async ({ roomId, settings }) => {
    const snap = await db.collection('rooms').where('id', '==', roomId).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const room = doc.data();

    room.settings = { ...room.settings, ...settings };
    await db.collection('rooms').doc(room.code).set(room);
    io.to(room.code).emit('room:updated', room);
  });

  // PIN MESSAGE
  socket.on('message:pin', async ({ roomId, messageId }) => {
    const snap = await db.collection('rooms').where('id', '==', roomId).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const room = doc.data();

    room.messages = room.messages.map(msg =>
      msg.id === messageId ? { ...msg, pinned: !msg.pinned } : msg
    );

    await db.collection('rooms').doc(room.code).set(room);
    io.to(room.code).emit('room:updated', room);
  });

  socket.on('disconnect', () => {
    console.log('❎ User disconnected:', socket.id);
  });
});

// Health check
app.get('/', (req, res) => {
  res.send('✅ Socket.IO server is live!');
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
