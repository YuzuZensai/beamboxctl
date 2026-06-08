import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";

export interface DiscoveredDevice {
  name: string | null;
  address: string;
}

export interface DeviceSelectorProps {
  devices: DiscoveredDevice[];
  scanning: boolean;
  onSelect: (device: DiscoveredDevice) => void;
}

export const DeviceSelector: React.FC<DeviceSelectorProps> = ({
  devices,
  scanning,
  onSelect,
}) => {
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);

  useInput((char, key) => {
    if (key.escape || (key.ctrl && char === "c")) {
      exit();
      process.exit(1);
    }

    if (devices.length === 0) return;

    if (key.upArrow) {
      setCursor((prev) => (prev - 1 + devices.length) % devices.length);
    }

    if (key.downArrow) {
      setCursor((prev) => (prev + 1) % devices.length);
    }

    if (key.return) {
      const selected = devices[cursor];
      if (selected) {
        onSelect(selected);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        {scanning ? (
          <Box gap={1}>
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            <Text color="cyan">Scanning for devices...</Text>
            {devices.length > 0 && (
              <Text color="gray">({devices.length} found so far)</Text>
            )}
          </Box>
        ) : (
          <Text color="green" bold>
            Found {devices.length} device{devices.length !== 1 ? "s" : ""}
          </Text>
        )}
      </Box>

      {devices.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
          {devices.map((device, i) => {
            const isSelected = i === cursor;
            return (
              <Box key={device.address} gap={1}>
                <Text color={isSelected ? "cyan" : "gray"}>
                  {isSelected ? "▶" : " "}
                </Text>
                <Box flexDirection="column">
                  <Text color={isSelected ? "white" : "gray"} bold={isSelected}>
                    {device.name ?? "(unnamed)"}
                  </Text>
                  <Text color={isSelected ? "cyan" : "gray"} dimColor={!isSelected}>
                    {device.address}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {!scanning && devices.length > 0 && (
        <Box marginTop={1}>
          <Text color="gray">↑↓ navigate  •  Enter select  •  Esc cancel</Text>
        </Box>
      )}

      {!scanning && devices.length === 0 && (
        <Text color="red">No devices found. Make sure your BeamBox is nearby and on.</Text>
      )}
    </Box>
  );
};
