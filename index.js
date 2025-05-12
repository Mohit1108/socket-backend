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
    origin: '*', // You can restrict this to your frontend domain
    methods: ['GET', 'POST']
  }
});

// In-memory room store
const rooms = {};

io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  // Create Room
  socket.on('room:create', (data) => {
    const { code, userId, nickname, defaultVideo } = data;

    const newRoom = {
      id: socket.id,
      code,
      users: [{ id: userId, nickname, isHost: true }],
      videoQueue: defaultVideo ? [defaultVideo] : [],
      messages: [],
      currentVideoIndex: defaultVideo ? 0 : -1,
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

    console.log(`✅ Room ${code} created by ${nickname} (${userId})`);
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

    // Add user if not already in room
    if (!room.users.find(u => u.id === userId)) {
      room.users.push({ id: userId, nickname, isHost: false });
    }

    socket.join(code);

    // Optionally add system message
    room.messages.push({
      id: `msg-${Date.now()}`,
      userId: 'system',
      nickname: 'System',
      text: `${nickname} joined the room!`,
      timestamp: Date.now(),
      isSystemMessage: true
    });

    console.log(`👥 ${nickname} (${userId}) joined room ${code}`);
    io.to(code).emit('room:updated', room);
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('❎ User disconnected:', socket.id);
    // You can optionally clean up here
  });
});

// Basic health check
app.get('/', (req, res) => {
  res.send('✅ Socket.IO server running!');
});

// Handle WebSocket upgrade (optional for Render)
server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => {}); // prevent crash on upgrade failure
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
