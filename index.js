const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

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

// In-memory room store
const rooms = {};

io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  // Create Room
  socket.on('room:create', ({ code, userId, nickname, defaultVideo }) => {
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

    rooms[code] = newRoom;
    socket.join(code);
    console.log(`✅ Room ${code} created by ${nickname}`);
    io.to(socket.id).emit('room:created', newRoom);
  });

  // Join Room
  socket.on('room:join', ({ code, userId, nickname }) => {
    const room = rooms[code];
    if (!room) {
      socket.emit('room:error', 'Room not found');
      console.warn(`❌ Join failed: Room ${code} not found`);
      return;
    }

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

    socket.join(code);
    console.log(`👥 ${nickname} joined room ${code}`);

    io.to(socket.id).emit('room:updated', room);
    socket.to(code).emit('room:updated', room);
  });

  // Leave Room
  socket.on('room:leave', ({ roomId, userId }) => {
    const room = Object.values(rooms).find(r => r.id === roomId);
    if (!room) return;

    room.users = room.users.filter(u => u.id !== userId);
    socket.leave(room.code);
    console.log(`🚪 User ${userId} left room ${room.code}`);
    io.to(room.code).emit('room:updated', room);
  });

  // Add Video
  socket.on('video:add', ({ roomId, queueItem }) => {
    const room = Object.values(rooms).find(r => r.id === roomId);
    if (!room) return;

    room.videoQueue.push(queueItem);
    if (room.currentVideoIndex === -1) {
      room.currentVideoIndex = 0;
      room.playerState.isPlaying = true;
      room.playerState.currentTime = 0;
      room.playerState.lastUpdated = Date.now();
    }

    io.to(room.code).emit('room:updated', room);
  });

  // Remove Video
  socket.on('video:remove', ({ roomId, videoId }) => {
    const room = Object.values(rooms).find(r => r.id === roomId);
    if (!room) return;

    room.videoQueue = room.videoQueue.filter(v => v.id !== videoId);
    io.to(room.code).emit('room:updated', room);
  });

  // Skip Video
  socket.on('video:skip', ({ roomId }) => {
    const room = Object.values(rooms).find(r => r.id === roomId);
    if (!room) return;

    if (room.currentVideoIndex < room.videoQueue.length - 1) {
      room.currentVideoIndex += 1;
    } else {
      room.currentVideoIndex = -1;
    }

    io.to(room.code).emit('room:updated', room);
  });

  // Play / Pause
  socket.on('video:playPause', ({ roomId, isPlaying }) => {
    const room = Object.values(rooms).find(r => r.id === roomId);
    if (!room) return;

    room.playerState.isPlaying = isPlaying;
    room.playerState.lastUpdated = Date.now();

    io.to(room.code).emit('room:updated', room);
  });

  // Seek
  socket.on('video:seek', ({ roomId, time }) => {
    const room = Object.values(rooms).find(r => r.id === roomId);
    if (!room) return;

    room.playerState.currentTime = time;
    room.playerState.lastUpdated = Date.now();

    io.to(room.code).emit('room:updated', room);
  });

  // Message
  socket.on('message:send', ({ roomId, message }) => {
    const room = Object.values(rooms).find(r => r.id === roomId);
    if (!room) return;

    room.messages.push(message);
    io.to(room.code).emit('room:updated', room);
  });

  // Reaction
  socket.on('reaction:send', ({ roomId, reaction }) => {
    io.to(roomId).emit('reaction:new', reaction);
  });

  // Update Nickname
  socket.on('user:update', ({ roomId, userId, nickname }) => {
    const room = Object.values(rooms).find(r => r.id === roomId);
    if (!room) return;

    const user = room.users.find(u => u.id === userId);
    if (user) {
      user.nickname = nickname;
      io.to(room.code).emit('room:updated', room);
    }
  });

  // Room Settings
  socket.on('room:updateSettings', ({ roomId, settings }) => {
    const room = Object.values(rooms).find(r => r.id === roomId);
    if (!room) return;

    room.settings = { ...room.settings, ...settings };
    io.to(room.code).emit('room:updated', room);
  });

  // Pin Message
  socket.on('message:pin', ({ roomId, messageId }) => {
    const room = Object.values(rooms).find(r => r.id === roomId);
    if (!room) return;

    room.messages = room.messages.map(msg =>
      msg.id === messageId ? { ...msg, pinned: !msg.pinned } : msg
    );

    io.to(room.code).emit('room:updated', room);
  });

  socket.on('disconnect', () => {
    console.log('❎ User disconnected:', socket.id);
  });
});

// Health Check
app.get('/', (req, res) => {
  res.send('✅ Socket.IO server is live!');
});

// Start Server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
