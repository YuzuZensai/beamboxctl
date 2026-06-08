import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";

interface UploadProgressProps {
  status: "connecting" | "uploading" | "success" | "error";
  message?: string;
  sendProgress?: number;
  confirmProgress?: number;
}

const BAR_LENGTH = 30;

const ShadowProgressBar: React.FC<{
  sendProgress: number;
  confirmProgress: number;
}> = ({ sendProgress, confirmProgress }) => {
  const sentFilled = Math.round((sendProgress / 100) * BAR_LENGTH);
  const confirmFilled = Math.round((confirmProgress / 100) * BAR_LENGTH);
  const pct = Math.round(sendProgress);

  const bar = Array.from({ length: BAR_LENGTH }, (_, i) => {
    if (i < confirmFilled)
      return (
        <Text key={i} color="green">
          █
        </Text>
      );
    if (i < sentFilled)
      return (
        <Text key={i} color="cyan">
          █
        </Text>
      );
    return (
      <Text key={i} color="dim">
        ░
      </Text>
    );
  });

  return (
    <Box marginTop={1}>
      <Text color="dim">[</Text>
      {bar}
      <Text color="dim">] {pct}%</Text>
    </Box>
  );
};

export const UploadProgress: React.FC<UploadProgressProps> = ({
  status,
  message,
  sendProgress = 0,
  confirmProgress = 0,
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

  const statusIcon =
    status === "success" ? "✓" : status === "error" ? "✗" : null;

  const showBar = status === "uploading" || status === "success";
  const effectiveSend = status === "success" ? 100 : sendProgress;
  const effectiveConfirm = status === "success" ? 100 : confirmProgress;

  const isConfirming =
    status === "uploading" && sendProgress >= 100 && confirmProgress < 100;
  const displayMessage = isConfirming
    ? (message?.replace(/^Sending:/, "Confirming:") ?? "Confirming...")
    : message || status.toUpperCase();

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
            {displayMessage}
          </Text>
        </Box>
      </Box>
      {showBar && (
        <ShadowProgressBar
          sendProgress={effectiveSend}
          confirmProgress={effectiveConfirm}
        />
      )}
    </Box>
  );
};
