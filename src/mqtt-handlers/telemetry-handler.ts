import { SensorData } from '../types.js'; // Note the .js extension required by NodeNext
import { prisma } from '../prisma.js';
import { io } from '../server.js';

export async function handleTelemetry(topic: string, messageBuffer: Buffer): Promise<void> {
  try {
    const payload: SensorData = JSON.parse(messageBuffer.toString());
    
    // Dynamically extract the specific Pi identifier from the path (e.g. "devices/rpi-01/telemetry")
    const topicParts = topic.split('/');
    const deviceId = topicParts[1] || 'unknown_device';

    console.log(`\n[📥 Telemetry Received] Device ID: ${deviceId}`);
    console.log(`▪ Temperature: ${payload.temp}°C`);
    console.log(`▪ Humidity:    ${payload.humidity}%`);

    // Save to Postgres via Prisma 7 client config setup
    await prisma.device.upsert({ where: { id: deviceId }, update: {}, create: { id: deviceId } });
    await prisma.telemetryLog.create({
      data: { deviceId, temp: payload.temp, humidity: payload.humidity }
    });

    // ─── NEW: Broadcast to all listening frontend browsers ───
    io.emit('frontend_telemetry', {
      deviceId,
      temp: payload.temp,
      humidity: payload.humidity,
      timestamp: new Date()
    });

  } catch (err) {
    console.error('❌ Failed to process telemetry JSON payload:', err);
  }
}