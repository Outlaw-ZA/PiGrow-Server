import Fastify from 'fastify';
import cors from '@fastify/cors';
import mqtt from 'mqtt';
import { handleTelemetry } from './mqtt-handlers/telemetry-handler.js';
import mqttMatch from 'mqtt-match';
import { Server as SocketIOServer } from 'socket.io';

// 1. Initialize Fastify and register CORS for the Frontend
const fastify = Fastify({ logger: true });
await fastify.register(cors, { origin: '*' });

// 2. Initialize Socket.io by binding it directly to Fastify's underlying HTTP server instance
export const io = new SocketIOServer(fastify.server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Fallback configuration parameters
const BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const mqttClient = mqtt.connect(BROKER_URL);

// 2. Manage frontend socket connections
io.on('connection', (socket) => {
  console.log(`💻 Frontend Client Connected: ${socket.id}`);

  // Listen for commands coming FROM the frontend dashboard to control the Pi
  socket.on('ui_command', (data) => {
    console.log('Command received from UI dashboard:', data);
    
    // Relay the frontend action down to the RPi via MQTT
    const targetTopic = `devices/${data.deviceId}/commands`;
    mqttClient.publish(targetTopic, JSON.stringify({
      action: data.action,
      pin: data.pin,
      timestamp: Date.now()
    }));
  });

  socket.on('disconnect', () => console.log('💻 Frontend Client Disconnected'));
});

// Dynamic Topic Registry Map
const topicRegistry: Record<string, (topic: string, message: Buffer) => void> = {
  'devices/+/telemetry': handleTelemetry,
};

mqttClient.on('connect', () => {
  console.log(`\n⚡ Backend Server connected to MQTT Broker at: ${BROKER_URL}`);

  // Subscribe to all registry definitions
  Object.keys(topicRegistry).forEach((topicPattern) => {
    mqttClient.subscribe(topicPattern, (err) => {
      if (!err) {
        console.log(`✔ Subscribed to: ${topicPattern}`);
      } else {
        console.error(`❌ Subscription failed for ${topicPattern}:`, err);
      }
    });
  });
});

// Central Message Pipeline Disambiguation
mqttClient.on('message', (topic: string, message: Buffer) => {
  // Try to find a pattern key in the registry that matches the incoming topic
  const matchingPattern = Object.keys(topicRegistry).find((pattern) => 
    mqttMatch(pattern, topic)
  );

  if (matchingPattern) {
    // Dynamically execute the handler assigned to that pattern
    topicRegistry[matchingPattern](topic, message);
  } else {
    console.warn(`⚠️ Warning: Received data on unhandled topic: ${topic}`);
  }
});

// 5. Start Fastify (Listen on Port 4000 for both REST and Socket.io traffic)
const start = async () => {
  try {
    // Listen on 0.0.0.0 so the server can accept traffic inside a Docker container
    await fastify.listen({ port: 4000, host: '0.0.0.0' });
    console.log('🚀 Unified Server engine listening on port 4000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();