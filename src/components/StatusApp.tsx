import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { Header, Status, ConnectionStatus } from "./index.ts";
import { useDeviceStatus } from "../hooks/useDeviceStatus.ts";
import type { StatusOptions } from "../cli/types.ts";

export interface StatusAppProps {
  options: StatusOptions;
  verbose: boolean;
}

export const StatusApp: React.FC<StatusAppProps> = ({ options }) => {
  const {
    loading,
    error,
    deviceStatus,
    notifications,
    connectionSteps,
  } = useDeviceStatus(options);

  return (
    <Box flexDirection="column" padding={1}>
      <Header />

      {loading && (
        <Box flexDirection="column">
          <Box>
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            <Text color="cyan" bold>
              {" "}
              Connecting to BeamBox device...
            </Text>
          </Box>
          <ConnectionStatus steps={connectionSteps} />
        </Box>
      )}

      {error && (
        <Box flexDirection="column">
          <Box>
            <Text color="red" bold>
              ✗ Connection Error
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray">{error}</Text>
          </Box>
          <Box marginTop={1}>
            <Text color="dim">
              Make sure your device is powered on and in range.
            </Text>
          </Box>
        </Box>
      )}

      {!loading && !error && (
        <Status
          status={deviceStatus}
          notifications={notifications}
          verbose={options.verbose}
        />
      )}
    </Box>
  );
};
