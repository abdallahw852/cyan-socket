import express from "express";
import http from "http";
import https from "https";
import { Server } from "socket.io";
import mongoose, { Schema, model } from "mongoose";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

// ====================================================
// MONGO CONNECTION
// ====================================================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ====================================================
// MONGOOSE SCHEMAS
// ====================================================

// Message schema
const MessageSchema = new Schema(
  {
    conversation: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, required: true },
  },
  { timestamps: true }
);
const Message = model("Message", MessageSchema);

// Conversation schema
const ConversationSchema = new Schema(
  {
    participants: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    lastMessage: { type: Schema.Types.ObjectId, ref: "Message", default: null },
  },
  { timestamps: true }
);
const Conversation = model("Conversation", ConversationSchema);

// ====================================================
// EXPRESS + SOCKET.IO SETUP
// ====================================================
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Keep track of connected users by email
const connectedUsers = new Map(); // email -> { socketId, userId }

// ====================================================
// SOCKET.IO EVENTS
// ====================================================
io.on("connection", (socket) => {
  console.log(`⚡ Connected: ${socket.id}`);

  // 1️⃣ Authenticate via manual token (for testing)
  socket.on("authenticate", (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      socket.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
      };

      console.log("✅ Authenticated user:", socket.user);

      connectedUsers.set(decoded.email, {
        socketId: socket.id,
        userId: decoded.id,
      });

      socket.emit("auth_success", socket.user);
    } catch (err) {
      console.error("❌ Invalid token", err.message);
      socket.emit("auth_error", "Invalid or expired token");
    }
  });

  // 2️⃣ Send message
  socket.on("send_message", async ({ toEmail, content }) => {
    if (!socket.user) return socket.emit("error", "You must authenticate first");

    const recipient = connectedUsers.get(toEmail);
    if (!recipient) return socket.emit("error", "Recipient not online");

    const senderId = socket.user.id;
    const receiverId = recipient.userId;

    // Find or create conversation between both users
    let conversation = await Conversation.findOne({
      participants: { $all: [senderId, receiverId] },
    });

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [senderId, receiverId],
      });
    }

    // Create and save message
    const message = await Message.create({
      conversation: conversation._id,
      sender: senderId,
      content,
    });

    // Update last message
    conversation.lastMessage = message._id;
    await conversation.save();

    // Send message to receiver
    io.to(recipient.socketId).emit("receive_message", {
      from: socket.user.email,
      content,
    });

    console.log(`💬 ${socket.user.email} → ${toEmail}: ${content}`);
  });

  // 3️⃣ Disconnect handler
  socket.on("disconnect", () => {
    if (socket.user) {
      connectedUsers.delete(socket.user.email);
      console.log(`❌ Disconnected: ${socket.user.email}`);
    }
  });
});

// ====================================================
// BASIC EXPRESS ENDPOINT
// ====================================================
app.get("/", (req, res) => {
  res.send("✅ Socket.IO server is running 🚀");
});

// ====================================================
// KEEP SERVER AWAKE (Render or Railway)
// ====================================================
setInterval(() => {
  https
    .get("https://cyan-socket.onrender.com", (res) =>
      console.log("Self-ping status:", res.statusCode)
    )
    .on("error", (err) => console.error("Self-ping failed:", err.message));
}, 10 * 60 * 1000); // every 10 minutes

// ====================================================
// START SERVER
// ====================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
