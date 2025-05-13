const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const db = require('./firebase');

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

function isUserHost(room, userId) {
  const user = room.users.find(u => u.id === userId);
  return user?.isHost === true;
}

io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  socket.on('room:create', async ({ code, userId, nickname, defaultVideo }) => {
    const newRoom = {
      id: code,
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
    io.to(socket.id).emit('room:created', newRoom);
  });

  socket.on('room:join', async ({ code, userId, nickname }) => {
    const doc = await db.collection('rooms').doc(code).get();
    if (!doc.exists) return socket.emit('room:error', 'Room not found');

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


  // Add this event handler in your backend socket.io code
socket.on('room:rejoin', async ({ code, userId, nickname }) => {
  const doc = await db.collection('rooms').doc(code).get();
  if (!doc.exists) return socket.emit('room:error', 'Room not found');

  const room = doc.data();
  const existingUser = room.users.find(u => u.id === userId);

  if (!existingUser) {
    room.users.push({ id: userId, nickname, isHost: false });
  } else {
    existingUser.nickname = nickname;
  }

  await db.collection('rooms').doc(code).set(room);
  socket.join(code);
  io.to(socket.id).emit('room:updated', room);
});


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

  socket.on('video:add', async ({ roomId, queueItem, userId }) => {
    const snap = await db.collection('rooms').where('id', '==', roomId).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const room = doc.data();

    if (!isUserHost(room, userId)) return socket.emit('room:error', 'Only host can add videos.');

    room.videoQueue.push(queueItem);
    if (room.currentVideoIndex === -1) {
      room.currentVideoIndex = 0;
      room.playerState = { isPlaying: true, currentTime: 0, lastUpdated: Date.now() };
    }

    await db.collection('rooms').doc(room.code).set(room);
    io.to(room.code).emit('room:updated', room);
  });

  socket.on('video:remove', async ({ roomId, videoId, userId }) => {
    const snap = await db.collection('rooms').where('id', '==', roomId).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const room = doc.data();

    if (!isUserHost(room, userId)) return socket.emit('room:error', 'Only host can remove videos.');

    room.videoQueue = room.videoQueue.filter(v => v.id !== videoId);
    await db.collection('rooms').doc(room.code).set(room);
    io.to(room.code).emit('room:updated', room);
  });

  socket.on('video:skip', async ({ roomId, userId }) => {
    const snap = await db.collection('rooms').where('id', '==', roomId).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const room = doc.data();

    if (!isUserHost(room, userId)) return socket.emit('room:error', 'Only host can skip videos.');

    room.currentVideoIndex = room.currentVideoIndex < room.videoQueue.length - 1
      ? room.currentVideoIndex + 1 : -1;

    await db.collection('rooms').doc(room.code).set(room);
    io.to(room.code).emit('room:updated', room);
  });

  socket.on('room:updateSettings', async ({ roomId, settings, userId }) => {
    const snap = await db.collection('rooms').where('id', '==', roomId).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const room = doc.data();

    if (!isUserHost(room, userId)) return socket.emit('room:error', 'Only host can update settings.');

    room.settings = { ...room.settings, ...settings };
    await db.collection('rooms').doc(room.code).set(room);
    io.to(room.code).emit('room:updated', room);
  });

  socket.on('message:pin', async ({ roomId, messageId, userId }) => {
    const snap = await db.collection('rooms').where('id', '==', roomId).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const room = doc.data();

    if (!isUserHost(room, userId)) return socket.emit('room:error', 'Only host can pin messages.');

    room.messages = room.messages.map(msg =>
      msg.id === messageId ? { ...msg, pinned: !msg.pinned } : msg
    );

    await db.collection('rooms').doc(room.code).set(room);
    io.to(room.code).emit('room:updated', room);
  });

// Modify the video:playPause event handler
socket.on('video:playPause', async ({ roomId, isPlaying }) => {
  const snap = await db.collection('rooms').where('id', '==', roomId).get();
  if (snap.empty) return;
  const doc = snap.docs[0];
  const room = doc.data();

  // Add serverTime for better sync
  room.playerState = {
    ...room.playerState,
    isPlaying,
    lastUpdated: Date.now(),
    serverTime: Date.now()
  };

  await db.collection('rooms').doc(room.code).set(room);
  io.to(room.code).emit('room:updated', room);
});

// Similarly for video:seek
socket.on('video:seek', async ({ roomId, time }) => {
  const snap = await db.collection('rooms').where('id', '==', roomId).get();
  if (snap.empty) return;
  const doc = snap.docs[0];
  const room = doc.data();

  room.playerState = {
    ...room.playerState,
    currentTime: time,
    lastUpdated: Date.now(),
    serverTime: Date.now()
  };

  await db.collection('rooms').doc(room.code).set(room);
  io.to(room.code).emit('room:updated', room);
});

// Add this helper function at the top
async function updateRoom(code, updates) {
  try {
    const roomRef = db.collection('rooms').doc(code);
    await roomRef.update(updates);
    return true;
  } catch (error) {
    console.error('Error updating room:', error);
    return false;
  }
}

// Then use it in your event handlers
socket.on('message:send', async ({ roomId, message }) => {
  try {
    const snap = await db.collection('rooms').where('id', '==', roomId).get();
    if (snap.empty) return;
    const doc = snap.docs[0];
    const room = doc.data();

    room.messages.push(message);
    const success = await updateRoom(room.code, { messages: room.messages });
    
    if (success) {
      io.to(room.code).emit('room:updated', room);
    }
  } catch (error) {
    console.error('Error sending message:', error);
    socket.emit('room:error', 'Failed to send message');
  }
});




  
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

  socket.on('disconnect', () => {
    console.log('❎ User disconnected:', socket.id);
  });
});

// Add this function to clean up inactive rooms
async function cleanupInactiveRooms() {
  try {
    const sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000);
    const snap = await db.collection('rooms').get();
    
    for (const doc of snap.docs) {
      const room = doc.data();
      if (room.users.length === 0 && room.playerState.lastUpdated < sixHoursAgo) {
        await doc.ref.delete();
      }
    }
  } catch (error) {
    console.error('Error cleaning up rooms:', error);
  }
}

// Run cleanup every hour
setInterval(cleanupInactiveRooms, 60 * 60 * 1000);


const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use(limiter);




app.get('/', (req, res) => {
  res.send('✅ Socket.IO server is live!');
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
