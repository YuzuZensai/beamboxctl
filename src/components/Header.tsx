import React from "react";
import { Box, Text } from "ink";
import BigText from "ink-big-text";
import { createRequire } from "node:module";

const PASTEL_PINK = "#FFB6C1";
const sponsorLink = "github.com/sponsors/YuzuZensai";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

export const Header: React.FC = () => {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <BigText text="BeamBox" font="tiny" />
      <Box gap={1}>
        <Text color="white">CLI tool for managing BeamBox e-Badge devices</Text>
        <Text color="gray">v{version}</Text>
      </Box>
      <Box>
        <Text color={PASTEL_PINK}>Support my work ♡{"  "}</Text>
        <Text color={PASTEL_PINK}>
          {`\x1b]8;;https://${sponsorLink}\x07${sponsorLink}\x1b]8;;\x07`}
        </Text>
      </Box>
    </Box>
  );
};
