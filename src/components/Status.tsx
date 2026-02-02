import { Box, Newline, Text } from "ink";
import type React from "react";
import type {
  DeviceStatus,
  ParsedResponse,
} from "../lib/protocol/interfaces/index.ts";

interface StatusProps {
  status: DeviceStatus | null;
  notifications: Array<{ time: number; data: Buffer; parsed: ParsedResponse }>;
  verbose: boolean;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / k ** i;
  return `${value.toFixed(2)} ${units[i]}`;
};

const StorageBar: React.FC<{ used: number; total: number }> = ({
  used,
  total,
}) => {
  const percentage = Math.round((used / total) * 100);
  const barLength = 20;
  const filledLength = Math.round((used / total) * barLength);
  const filled = "█".repeat(filledLength);
  const empty = "░".repeat(barLength - filledLength);

  const getBarColor = () => {
    if (percentage < 50) return "green";
    if (percentage < 75) return "yellow";
    return "red";
  };

  return (
    <Box marginTop={1}>
      <Text color="dim">[</Text>
      <Text color={getBarColor()}>{filled}</Text>
      <Text color="dim">{empty}]</Text>
      <Text color="dim"> {percentage}%</Text>
    </Box>
  );
};

export const Status: React.FC<StatusProps> = ({
  status,
  notifications,
  verbose,
}) => {
  const allspace = typeof status?.allspace === "number" ? status.allspace : 0;
  const freespace =
    typeof status?.freespace === "number" ? status.freespace : 0;
  const usedSpace = allspace - freespace;
  const freePercentage =
    allspace > 0 ? Math.round((freespace / allspace) * 100) : 0;

  return (
    <Box flexDirection="column" padding={1}>
      {status && (
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Text bold color="green">
              Device Status
            </Text>
          </Box>

          <Box marginTop={1} paddingLeft={2} flexDirection="column">
            <Box>
              <Text color="cyan" bold>
                Storage Information
              </Text>
            </Box>

            <Box paddingLeft={2} flexDirection="column">
              <Box marginBottom={0.5}>
                <Box width={12}>
                  <Text color="gray">Total:</Text>
                </Box>
                <Text color="white">{formatBytes(allspace)}</Text>
              </Box>
              <Box marginBottom={0.5}>
                <Box width={12}>
                  <Text color="gray">Free:</Text>
                </Box>
                <Text color="green">{formatBytes(freespace)}</Text>
                <Text color="dim"> ({freePercentage}%)</Text>
              </Box>
              <Box marginBottom={0.5}>
                <Box width={12}>
                  <Text color="gray">Used:</Text>
                </Box>
                <Text color="yellow">{formatBytes(usedSpace)}</Text>
                <Text color="dim"> ({100 - freePercentage}%)</Text>
              </Box>

              <StorageBar used={usedSpace} total={allspace} />
            </Box>

            <Box marginTop={2}>
              <Text color="cyan" bold>
                Device Information
              </Text>
            </Box>

            <Box paddingLeft={2} flexDirection="column">
              {status.size !== undefined && status.size !== null && (
                <Box marginBottom={0.5}>
                  <Box width={12}>
                    <Text color="gray">Resolution:</Text>
                  </Box>
                  <Text color="white">
                    {String(status.size).replace(",", "x")}
                  </Text>
                  <Text color="dim"> pixels</Text>
                </Box>
              )}

              {status.devname !== undefined && (
                <Box marginBottom={0.5}>
                  <Box width={12}>
                    <Text color="gray">Name:</Text>
                  </Box>
                  <Text>{String(status.devname) || "<not set>"}</Text>
                </Box>
              )}

              {typeof status.brand === "number" && (
                <Box marginBottom={0.5}>
                  <Box width={12}>
                    <Text color="gray">Brand:</Text>
                  </Box>
                  <Text>#{status.brand}</Text>
                </Box>
              )}
            </Box>

            {verbose && (
              <Box marginTop={1} paddingLeft={2}>
                <Text color="dim">Raw JSON:</Text>
                <Newline />
                <Text color="gray">{JSON.stringify(status, null, 2)}</Text>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {!status && (
        <Box>
          <Text color="yellow">⚠ No device status received</Text>
        </Box>
      )}

      {verbose && notifications.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Box marginBottom={1}>
            <Text bold>Protocol Notifications: {notifications.length}</Text>
          </Box>

          <Box flexDirection="column" marginTop={1}>
            {notifications.slice(0, 20).map((notif, index) => {
              const timestamp = new Date(notif.time).toLocaleTimeString();
              return (
                <Box key={index} marginBottom={1} paddingLeft={2}>
                  <Box>
                    <Text color="dim">
                      [{index + 1}] {timestamp}
                    </Text>
                  </Box>
                  <Box marginTop={0.5}>
                    <Text color="gray">{notif.data.length} bytes</Text>
                    {verbose && (
                      <Text color="dim">
                        {" "}
                        | Hex: {notif.data.toString("hex")}
                      </Text>
                    )}
                  </Box>
                  {notif.parsed.rawText && (
                    <Box marginTop={0.5} paddingLeft={4}>
                      <Text color="cyan">Text:</Text>
                      <Text> {notif.parsed.rawText}</Text>
                    </Box>
                  )}
                </Box>
              );
            })}

            {notifications.length > 20 && (
              <Box marginTop={1}>
                <Text color="gray">
                  ... and {notifications.length - 20} more notifications
                </Text>
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};
