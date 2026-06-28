/*
  Warnings:

  - Added the required column `sensorId` to the `Telemetry` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `sensorType` on the `Telemetry` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "SensorType" AS ENUM ('HUMIDITY', 'TEMPERATURE', 'TEMP_HUMIDITY', 'CO2', 'PH', 'EC');

-- CreateEnum
CREATE TYPE "SensorProtocol" AS ENUM ('I2C', 'SPI', 'UART', 'RS485');

-- AlterTable
ALTER TABLE "Telemetry" ADD COLUMN     "sensorId" TEXT NOT NULL,
DROP COLUMN "sensorType",
ADD COLUMN     "sensorType" "SensorType" NOT NULL;

-- CreateTable
CREATE TABLE "Sensor" (
    "id" TEXT NOT NULL,
    "controllerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SensorType" NOT NULL,
    "mqttTopic" TEXT NOT NULL,
    "pinNumbers" INTEGER[],
    "protocol" "SensorProtocol" NOT NULL,
    "lastActive" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sensor_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Sensor" ADD CONSTRAINT "Sensor_controllerId_fkey" FOREIGN KEY ("controllerId") REFERENCES "Controller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Telemetry" ADD CONSTRAINT "Telemetry_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
