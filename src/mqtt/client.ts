import mqtt from "mqtt";

const BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";

export const mqttClient = mqtt.connect(BROKER_URL);

export const MQTT_BROKER_URL = BROKER_URL;
