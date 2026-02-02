import { Box, Text } from "ink";
import type React from "react";

export interface ConnectionStep {
  id: string;
  label: string;
  status: "pending" | "active" | "complete" | "error";
  error?: string;
}

interface ConnectionStatusProps {
  steps: ConnectionStep[];
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  steps,
}) => {
  const activeStep = steps.find((s) => s.status === "active");
  const lastCompletedStep = [...steps]
    .reverse()
    .find((s) => s.status === "complete");
  const errorStep = steps.find((s) => s.status === "error");

  if (errorStep) {
    return (
      <Box marginTop={1}>
        <Text color="red">✗ {errorStep.label} failed</Text>
        {errorStep.error && <Text color="dim"> ({errorStep.error})</Text>}
      </Box>
    );
  }

  if (activeStep) {
    return (
      <Box marginTop={1}>
        <Text color="cyan">{activeStep.label}</Text>
        <Text color="dim">...</Text>
      </Box>
    );
  }

  if (lastCompletedStep) {
    return (
      <Box marginTop={1}>
        <Text color="green">✓ {lastCompletedStep.label}</Text>
      </Box>
    );
  }

  const firstPending = steps.find((s) => s.status === "pending");
  if (firstPending) {
    return (
      <Box marginTop={1}>
        <Text color="gray">{firstPending.label}</Text>
      </Box>
    );
  }

  return null;
};
