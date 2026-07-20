CREATE TYPE "DeviceProvisionState" AS ENUM ('UNCLAIMED', 'ACTIVE', 'INACTIVE');

ALTER TABLE "Controller"
    ADD COLUMN "provisionState" "DeviceProvisionState" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "deviceSerial" TEXT,
    ADD COLUMN "claimPinHash" TEXT,
    ADD COLUMN "pinExpiresAt" TIMESTAMP(3),
    ADD COLUMN "lastBeaconAt" TIMESTAMP(3),
    ADD COLUMN "mqttUsername" TEXT,
    ADD COLUMN "mqttPasswordHash" TEXT;

CREATE UNIQUE INDEX "Controller_mqttUsername_key" ON "Controller"("mqttUsername");
