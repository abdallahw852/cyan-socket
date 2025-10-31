import express from "express";
import http from "http";
import { Server } from "socket.io";

// ----------- Simple Trie Implementation -----------
class TrieNode {
  constructor() {
    this.children = {};
    this.isEndOfWord = false;
    this.socketId = null; // store socket ID here
  }
}

class Trie {
  constructor() {
    this.root = new TrieNode();
  }

  insert(email, socketId) {
    let node = this.root;
    for (let char of email) {
      if (!node.children[char]) {
        node.children[char] = new TrieNode();
      }
      node = node.children[char];
    }
    node.isEndOfWord = true;
    node.socketId = socketId;
  }

  remove(email) {
    const removeHelper = (node, depth = 0) => {
      if (!node) return false;

      if (depth === email.length) {
        if (!node.isEndOfWord) return false;
        node.isEndOfWord = false;
        node.socketId = null;

        return Object.keys(node.children).length === 0;
      }

      const char = email[depth];
      if (!removeHelper(node.children[char], depth + 1)) return false;

      delete node.children[char];
      return !node.isEndOfWord && Object.keys(node.children).length === 0;
    };

    removeHelper(this.root);
  }

  search(email) {
    let node = this.root;
    for (let char of email) {
      if (!node.children[char]) return null;
      node = node.children[char];
    }
    return node.isEndOfWord ? node.socketId : null;
  }
}

// ----------- Express + Socket.IO Setup -----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const trie = new Trie();
const emailToSocket = new Map();

// ----------- Socket.IO Events -----------
io.on("connection", (socket) => {
  console.log(`⚡ User connected: ${socket.id}`);

  // Receive user email and store in trie
  socket.on("register", (email) => {
    console.log(`📧 Registered: ${email} -> ${socket.id}`);
    trie.insert(email, socket.id);
    emailToSocket.set(email, socket.id);
  });

  // Handle sending messages by email
  socket.on("send_message", ({ toEmail, message }) => {
    const targetSocketId = trie.search(toEmail);
    if (targetSocketId) {
      io.to(targetSocketId).emit("receive_message", {
        from: socket.id,
        message,
      });
    } else {
      socket.emit("error_message", `❌ User ${toEmail} not found or offline`);
    }
  });

  // Remove user from trie on disconnect
  socket.on("disconnect", () => {
    for (const [email, id] of emailToSocket.entries()) {
      if (id === socket.id) {
        trie.remove(email);
        emailToSocket.delete(email);
        console.log(`❌ Disconnected & removed: ${email}`);
        break;
      }
    }
  });
});

// ----------- Express Route -----------
app.get("/", (req, res) => {
  res.send("✅ Socket.IO server is running");
});

// ----------- Start Server -----------
const PORT = 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
