import mqtt from 'mqtt'

const BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883'

export const mqttClient = mqtt.connect(BROKER_URL)

export const MQTT_BROKER_URL = BROKER_URL

export function endMqtt(): Promise<void> {
  return new Promise((resolve) => {
    // `end(true)` forces close even if a connection is in progress.
    // The callback fires after the underlying socket is closed, which is
    // What `node --test` needs to see in order to exit the process.
    try {
      mqttClient.end(true, {}, () => resolve())
    } catch {
      resolve()
    }
  })
}
