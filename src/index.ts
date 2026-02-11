import { createServer } from "http";
import { Server, Socket } from "socket.io";
import express from "express";
import cors from "cors";
import { createClient } from "@deepgram/sdk";
import dotenv from "dotenv";

const app = express();

dotenv.config();

const deepgram = createClient(process.env.DEEPGRAM_API_KEY!);

const connectedSockets: Map<string, Socket> = new Map();

const lastStreamingMessage: Map<string, string> = new Map();

type Service =
  | "gmail"
  | "google-docs"
  | "sheets"
  | "calendar"
  | "drive"
  | "outlook"
  | "slack"
  | "notion"
  | "google-forms"
  | "twitter"
  | "calendly"
  | "reddit";

interface Question {
  q: string;
  for: Service[];
}

async function streamVoiceMessage(
  message: string,
  socketId: string,
  status: boolean,
) {
  const sock = connectedSockets.get(socketId);
  if (!sock) {
    console.log("❌ Invalid socketId:", socketId);
    return;
  }

  console.log("inside here");

  const response = await deepgram.speak.request(
    { text: message },
    {
      model: "aura-2-thalia-en",
      // encoding: "linear16",
      // container: "wav",
      encoding: "linear16",
      container: "wav",
      sample_rate: 48000,
    },
  );

  const stream = await response.getStream();
  if (!stream) throw new Error("Audio generation failed");

  const reader = stream.getReader();

  // // Send text metadata once
  // console.log("sent here");
  // sock.emit("streamVoiceMessage", { message, status });

  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // console.log("sent audoStream")
    // console.log("sending chunk");
    // sock.emit("audioStream", Buffer.from(value));
    chunks.push(value);
  }

  const audioBuffer = Buffer.concat(chunks);

  sock.emit("streamVoiceMessage", { message, status, audioBuffer });

  console.log("done sending audio streams");

  // Signal end of audio
  // sock.emit("audioStreamEnd");

  if (status) {
    lastStreamingMessage.set(socketId, message);
  }
}

function streamMessage(
  message: string,
  socketId: string,
  status: boolean,
  stepData: string,
) {
  const sock = connectedSockets.get(socketId);
  console.log("stepData", stepData);
  if (sock) {
    sock.emit("streamMessage", { message, status, stepData });
    if (status) {
      lastStreamingMessage.set(socketId, message);
    }
    console.log(
      "streamMessage sent:",
      message,
      "to",
      socketId,
      "status",
      status,
      "stepData",
      stepData,
    );
  } else {
    console.log("❌ Invalid socketId:", socketId);
  }
}

const streamVoiceMessageController = (req: any, res: any) => {
  const { message, socketId, status } = req.body;

  console.log("inside streamVoiceMessage here", { socketId, message });

  if (!message || !socketId || !status) {
    return res
      .status(400)
      .json({ error: "message, socketId, and status required" });
  }

  streamVoiceMessage(message, socketId, status);
  return res.json({ ok: true });
};

const streamMessageController = (req: any, res: any) => {
  const { message, socketId, status, extraData } = req.body;

  if (!message || !socketId || !status) {
    return res
      .status(400)
      .json({ error: "message, socketId, and status required" });
  }

  streamMessage(message, socketId, status, extraData || "");
  return res.json({ ok: true });
};

app.use(express.json());
app.use(
  cors({
    // write paxio
    origin: [
      "http://localhost:3001",
      "https://paxio.tech",
      "https://www.paxio.tech",
    ],
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  }),
);

app.post("/stream-voice-message", streamVoiceMessageController);
app.post("/stream-message", streamMessageController);

const pendingAbortRequests = new Map<
  string,
  { resolve: () => void; reject: () => void; timeout: NodeJS.Timeout }
>();

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    // write the frontend here
    origin: "http://localhost:3001",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket: Socket) => {
  console.log("⚡ Client connected:", socket.id);
  connectedSockets.set(socket.id, socket);

  socket.on("abort", () => {
    console.log("Abort received from socket:", socket.id);
    const pending = pendingAbortRequests.get(socket.id);
    if (pending) {
      pending.resolve();
      pendingAbortRequests.delete(socket.id);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
    connectedSockets.delete(socket.id);
  });
});

// running at 3000 here
httpServer.listen(3000, () => {
  console.log(
    "🚀 Socket.IO + REST API server running on http://localhost:3000 => api.sabros.com",
  );
});
