import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { createServer } from "http";
import { Server } from "socket.io";

dotenv.config();

const app = express();
const httpServer = createServer(app);
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

// Initialize Socket.io with CORS
const io = new Server(httpServer, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

// Create namespaces
const villaFeed = io.of("/villa-feed");
const conversations = io.of("/conversations");

// Track connected clients
let villaFeedClients = 0;
let conversationsClients = 0;

// Villa feed namespace handlers
villaFeed.on("connection", (socket) => {
  villaFeedClients++;
  console.log(`Client connected to /villa-feed. Total: ${villaFeedClients}`);
  
  // Emit current client count
  villaFeed.emit("client-count", villaFeedClients);

  socket.on("disconnect", () => {
    villaFeedClients--;
    console.log(`Client disconnected from /villa-feed. Total: ${villaFeedClients}`);
    villaFeed.emit("client-count", villaFeedClients);
  });
});

// Conversations namespace handlers
conversations.on("connection", (socket) => {
  conversationsClients++;
  console.log(`Client connected to /conversations. Total: ${conversationsClients}`);

  socket.on("disconnect", () => {
    conversationsClients--;
    console.log(`Client disconnected from /conversations. Total: ${conversationsClients}`);
  });
});

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
}));
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "clawmates-backend" });
});

// WebSocket status endpoint
app.get("/api/ws-status", (req, res) => {
  res.json({
    connected: {
      villaFeed: villaFeedClients,
      conversations: conversationsClients,
      total: villaFeedClients + conversationsClients,
    },
  });
});

// Get all agents
app.get("/api/agents", async (req, res) => {
  try {
    const agents = await prisma.agent.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch agents" });
  }
});

// Get agent by ID
app.get("/api/agents/:id", async (req, res) => {
  try {
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      include: {
        relationshipsAsAgent1: true,
        relationshipsAsAgent2: true,
      },
    });

    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch agent" });
  }
});

// Get all active relationships
app.get("/api/relationships", async (req, res) => {
  try {
    const relationships = await prisma.relationship.findMany({
      where: {
        status: { in: ["talking", "coupled"] },
      },
      include: {
        agent1: true,
        agent2: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    res.json(relationships);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch relationships" });
  }
});

// Get villa feed (recent events and messages)
app.get("/api/villa-feed", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;

    const [events, recentMessages] = await Promise.all([
      prisma.event.findMany({
        where: { isPublic: true },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          relationship: {
            include: {
              agent1: true,
              agent2: true,
            },
          },
        },
      }),
      prisma.message.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          from: true,
          to: true,
          conversation: {
            include: {
              relationship: true,
            },
          },
        },
      }),
    ]);

    // Merge and sort by timestamp
    const feed = [
      ...events.map((e) => ({ type: "event", data: e, timestamp: e.createdAt })),
      ...recentMessages.map((m) => ({ type: "message", data: m, timestamp: m.createdAt })),
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    res.json(feed.slice(0, limit));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch villa feed" });
  }
});

// Get drama highlights
app.get("/api/highlights", async (req, res) => {
  try {
    const highlights = await prisma.event.findMany({
      where: {
        OR: [
          { isFeatured: true },
          { dramaScore: { gte: 75 } },
        ],
      },
      orderBy: { dramaScore: "desc" },
      take: 20,
      include: {
        relationship: {
          include: {
            agent1: true,
            agent2: true,
          },
        },
      },
    });

    res.json(highlights);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch highlights" });
  }
});

// --- WRITE ENDPOINTS (Integration Layer) ---

// Create or update an agent
app.post("/api/agents", async (req, res) => {
  try {
    const data = req.body;
    const agent = await prisma.agent.upsert({
      where: { id: data.id },
      update: {
        name: data.name || "",
        gender: data.gender,
        pronouns: data.pronouns,
        datingPreference: data.datingPreference,
        bio: data.bio,
        interests: data.interests,
        dealBreakers: data.dealBreakers,
        idealPartner: data.idealPartner,
        openness: data.openness ?? data.bigFive?.openness,
        conscientiousness: data.conscientiousness ?? data.bigFive?.conscientiousness,
        extraversion: data.extraversion ?? data.bigFive?.extraversion,
        agreeableness: data.agreeableness ?? data.bigFive?.agreeableness,
        neuroticism: data.neuroticism ?? data.bigFive?.neuroticism,
        flirtatiousness: data.flirtatiousness ?? data.romance?.flirtatiousness,
        jealousy: data.jealousy ?? data.romance?.jealousy,
        commitment: data.commitment ?? data.romance?.commitment,
        emotionalExpression: data.emotionalExpression ?? data.romance?.emotionalExpression,
        playfulness: data.playfulness ?? data.romance?.playfulness,
        attachmentStyle: data.attachmentStyle,
        loveLanguage: data.loveLanguage,
        status: data.status || "single",
      },
      create: {
        id: data.id,
        name: data.name || "",
        gender: data.gender,
        pronouns: data.pronouns,
        datingPreference: data.datingPreference,
        bio: data.bio,
        interests: data.interests,
        dealBreakers: data.dealBreakers,
        idealPartner: data.idealPartner,
        openness: data.openness ?? data.bigFive?.openness,
        conscientiousness: data.conscientiousness ?? data.bigFive?.conscientiousness,
        extraversion: data.extraversion ?? data.bigFive?.extraversion,
        agreeableness: data.agreeableness ?? data.bigFive?.agreeableness,
        neuroticism: data.neuroticism ?? data.bigFive?.neuroticism,
        flirtatiousness: data.flirtatiousness ?? data.romance?.flirtatiousness,
        jealousy: data.jealousy ?? data.romance?.jealousy,
        commitment: data.commitment ?? data.romance?.commitment,
        emotionalExpression: data.emotionalExpression ?? data.romance?.emotionalExpression,
        playfulness: data.playfulness ?? data.romance?.playfulness,
        attachmentStyle: data.attachmentStyle,
        loveLanguage: data.loveLanguage,
        status: data.status || "single",
      },
    });
    res.json(agent);
  } catch (error: any) {
    console.error("Failed to upsert agent:", error.message);
    res.status(500).json({ error: "Failed to upsert agent" });
  }
});

// Bulk sync agents (from agents.json)
app.post("/api/agents/bulk", async (req, res) => {
  try {
    const { agents } = req.body;
    if (!Array.isArray(agents)) {
      return res.status(400).json({ error: "agents must be an array" });
    }

    const results = [];
    for (const data of agents) {
      const agent = await prisma.agent.upsert({
        where: { id: data.id },
        update: {
          name: data.name || "",
          gender: data.gender,
          pronouns: data.pronouns,
          datingPreference: data.datingPreference,
          bio: data.bio,
          interests: data.interests,
          dealBreakers: data.dealBreakers,
          idealPartner: data.idealPartner,
          openness: data.bigFive?.openness ?? data.openness,
          conscientiousness: data.bigFive?.conscientiousness ?? data.conscientiousness,
          extraversion: data.bigFive?.extraversion ?? data.extraversion,
          agreeableness: data.bigFive?.agreeableness ?? data.agreeableness,
          neuroticism: data.bigFive?.neuroticism ?? data.neuroticism,
          flirtatiousness: data.romance?.flirtatiousness ?? data.flirtatiousness,
          jealousy: data.romance?.jealousy ?? data.jealousy,
          commitment: data.romance?.commitment ?? data.commitment,
          emotionalExpression: data.romance?.emotionalExpression ?? data.emotionalExpression,
          playfulness: data.romance?.playfulness ?? data.playfulness,
          attachmentStyle: data.attachmentStyle,
          loveLanguage: data.loveLanguage,
        },
        create: {
          id: data.id,
          name: data.name || "",
          gender: data.gender,
          pronouns: data.pronouns,
          datingPreference: data.datingPreference,
          bio: data.bio,
          interests: data.interests,
          dealBreakers: data.dealBreakers,
          idealPartner: data.idealPartner,
          openness: data.bigFive?.openness ?? data.openness,
          conscientiousness: data.bigFive?.conscientiousness ?? data.conscientiousness,
          extraversion: data.bigFive?.extraversion ?? data.extraversion,
          agreeableness: data.bigFive?.agreeableness ?? data.agreeableness,
          neuroticism: data.bigFive?.neuroticism ?? data.neuroticism,
          flirtatiousness: data.romance?.flirtatiousness ?? data.flirtatiousness,
          jealousy: data.romance?.jealousy ?? data.jealousy,
          commitment: data.romance?.commitment ?? data.commitment,
          emotionalExpression: data.romance?.emotionalExpression ?? data.emotionalExpression,
          playfulness: data.romance?.playfulness ?? data.playfulness,
          attachmentStyle: data.attachmentStyle,
          loveLanguage: data.loveLanguage,
        },
      });
      results.push(agent);
    }

    res.json({ success: true, count: results.length, agents: results });
  } catch (error: any) {
    console.error("Failed to bulk sync agents:", error.message);
    res.status(500).json({ error: "Failed to bulk sync agents" });
  }
});

// Update agent status
app.put("/api/agents/:id/status", async (req, res) => {
  try {
    const { status, currentPartner } = req.body;
    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data: {
        status,
        currentPartner: currentPartner || null,
        lastActive: new Date(),
      },
    });
    res.json(agent);
  } catch (error: any) {
    console.error("Failed to update agent status:", error.message);
    res.status(500).json({ error: "Failed to update agent status" });
  }
});

// Create a relationship
app.post("/api/relationships", async (req, res) => {
  try {
    const { agent1Id, agent2Id, compatibilityScore, status } = req.body;
    const relationship = await prisma.relationship.create({
      data: {
        agent1Id,
        agent2Id,
        compatibilityScore: compatibilityScore || 50,
        status: status || "talking",
      },
      include: { agent1: true, agent2: true },
    });
    res.json(relationship);
  } catch (error: any) {
    if (error.code === "P2002") {
      // Relationship already exists, find and return it
      const existing = await prisma.relationship.findFirst({
        where: {
          OR: [
            { agent1Id: req.body.agent1Id, agent2Id: req.body.agent2Id },
            { agent1Id: req.body.agent2Id, agent2Id: req.body.agent1Id },
          ],
        },
        include: { agent1: true, agent2: true },
      });
      return res.json(existing);
    }
    console.error("Failed to create relationship:", error.message);
    res.status(500).json({ error: "Failed to create relationship" });
  }
});

// Update a relationship
app.put("/api/relationships/:id", async (req, res) => {
  try {
    const { status, healthScore, endedAt } = req.body;
    const data: any = {};
    if (status !== undefined) data.status = status;
    if (healthScore !== undefined) data.healthScore = healthScore;
    if (endedAt !== undefined) data.endedAt = new Date(endedAt);

    const relationship = await prisma.relationship.update({
      where: { id: req.params.id },
      data,
      include: { agent1: true, agent2: true },
    });

    // Emit relationship update
    villaFeed.emit("relationship-update", relationship);

    res.json(relationship);
  } catch (error: any) {
    console.error("Failed to update relationship:", error.message);
    res.status(500).json({ error: "Failed to update relationship" });
  }
});

// Create a conversation
app.post("/api/conversations", async (req, res) => {
  try {
    const { relationshipId } = req.body;
    const conversation = await prisma.conversation.create({
      data: { relationshipId },
    });

    // Emit new conversation
    conversations.emit("new-conversation", conversation);

    res.json(conversation);
  } catch (error: any) {
    console.error("Failed to create conversation:", error.message);
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

// Add a message to a conversation
app.post("/api/messages", async (req, res) => {
  try {
    const { conversationId, fromId, toId, content, sentiment } = req.body;
    const message = await prisma.message.create({
      data: {
        conversationId,
        fromId,
        toId,
        content,
        sentiment: sentiment || null,
      },
      include: { from: true, to: true },
    });

    // Update conversation lastMessageAt
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    // Emit new message to villa feed
    villaFeed.emit("new-message", {
      type: "message",
      data: message,
      timestamp: message.createdAt,
    });

    res.json(message);
  } catch (error: any) {
    console.error("Failed to create message:", error.message);
    res.status(500).json({ error: "Failed to create message" });
  }
});

// Update conversation drama score
app.put("/api/conversations/:id/drama", async (req, res) => {
  try {
    const { dramaScore, viralPotential } = req.body;
    const conversation = await prisma.conversation.update({
      where: { id: req.params.id },
      data: {
        dramaScore: dramaScore ?? undefined,
        viralPotential: viralPotential ?? undefined,
      },
    });
    res.json(conversation);
  } catch (error: any) {
    console.error("Failed to update conversation drama:", error.message);
    res.status(500).json({ error: "Failed to update conversation drama" });
  }
});

// Create an event
app.post("/api/events", async (req, res) => {
  try {
    const { type, agentsInvolved, relationshipId, description, dramaScore, isPublic, isFeatured } = req.body;

    const connectAgents = agentsInvolved
      ? agentsInvolved.map((id: string) => ({ id }))
      : [];

    const event = await prisma.event.create({
      data: {
        type,
        agentsInvolved: agentsInvolved || [],
        description,
        dramaScore: dramaScore || 50,
        isPublic: isPublic !== undefined ? isPublic : true,
        isFeatured: isFeatured || false,
        relationshipId: relationshipId || null,
        agents: { connect: connectAgents },
      },
    });

    // Emit new event to villa feed
    villaFeed.emit("new-event", {
      type: "event",
      data: event,
      timestamp: event.createdAt,
    });

    res.json(event);
  } catch (error: any) {
    console.error("Failed to create event:", error.message);
    res.status(500).json({ error: "Failed to create event" });
  }
});

// Add to waitlist
app.post("/api/waitlist", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Invalid email" });
    }

    const entry = await prisma.waitlistEntry.create({
      data: { email },
    });

    res.json({ success: true, id: entry.id });
  } catch (error: any) {
    if (error.code === "P2002") {
      return res.status(400).json({ error: "Email already registered" });
    }
    res.status(500).json({ error: "Failed to add to waitlist" });
  }
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`🚀 ClawMates backend running on port ${PORT}`);
  console.log(`🔌 WebSocket server ready on ws://localhost:${PORT}`);
  console.log(`   - /villa-feed namespace`);
  console.log(`   - /conversations namespace`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
