import React, { useEffect } from "react";
import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import { Header, Status, ConnectionStatus } from "./index.ts";
import { useDeviceStatus } from "../hooks/useDeviceStatus.ts";
import type { StatusOptions } from "../cli/types.ts";

export interface StatusAppProps {
  options: StatusOptions;
  verbose: boolean;
}

export const StatusApp: React.FC<StatusAppProps> = ({ options }) => {
  const { exit } = useApp();
  const { loading, error, deviceStatus, notifications, connectionSteps } =
    useDeviceStatus(options);

  // Exit the app when done
  useEffect(() => {
    if (!loading) {
      // Give time for the final render, then exit
      const timer = setTimeout(() => {
        exit();
        // Force exit since noble keeps handles open
        process.exit(error ? 1 : 0);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [loading, error, exit]);

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
