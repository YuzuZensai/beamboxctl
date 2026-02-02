import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";

interface UploadProgressProps {
  status: "connecting" | "uploading" | "success" | "error";
  message?: string;
  progress?: number;
}

const ProgressBar: React.FC<{ progress: number }> = ({ progress }) => {
  const percentage = Math.round(progress);
  const barLength = 30;
  const filledLength = Math.round((progress / 100) * barLength);
  const filled = "█".repeat(filledLength);
  const empty = "░".repeat(barLength - filledLength);

  const getBarColor = () => {
    if (percentage < 100) return "cyan";
    return "green";
  };

  const barContent = filled + empty;

  return (
    <Box marginTop={1}>
      <Text color="dim">[</Text>
      <Text color={getBarColor()}>{barContent}</Text>
      <Text color="dim">] {percentage}%</Text>
    </Box>
  );
};

export const UploadProgress: React.FC<UploadProgressProps> = ({
  status,
  message,
  progress,
}) => {
  const getStatusColor = () => {
    switch (status) {
      case "connecting":
        return "cyan";
      case "uploading":
        return "blue";
      case "success":
        return "green";
      case "error":
        return "red";
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case "success":
        return "✓";
      case "error":
        return "✗";
      default:
        return null;
    }
  };

  const statusIcon = getStatusIcon();

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box>
        {!statusIcon && (
          <Text color={getStatusColor()}>
            <Spinner type="dots" />
          </Text>
        )}
        {statusIcon && <Text color={getStatusColor()}>{statusIcon}</Text>}
        <Box marginLeft={1}>
          <Text color={getStatusColor()} bold>
            {message || status.toUpperCase()}
          </Text>
        </Box>
      </Box>
      {progress !== undefined && status === "uploading" && (
        <ProgressBar progress={progress} />
      )}
    </Box>
  );
};
