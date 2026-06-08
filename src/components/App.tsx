import React, { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import {
  Header,
  UploadProgress,
  ConnectionStatus,
  ConfirmAnimatedUpload,
  DeviceSelector,
} from "./index.ts";
import { useUpload } from "../hooks/useUpload.ts";
import type { UploadOptions } from "../cli/types.ts";

export interface AppProps {
  options: UploadOptions;
  verbose: boolean;
  /** Set when the upload contains a GIF/video and requires user confirmation */
  confirmMediaType?: "gif" | "video" | null;
}

export const App: React.FC<AppProps> = ({
  options,
  verbose,
  confirmMediaType,
}) => {
  const [confirmed, setConfirmed] = useState(!confirmMediaType);

  if (!confirmed && confirmMediaType) {
    return (
      <ConfirmAnimatedUpload
        mediaType={confirmMediaType}
        onConfirm={() => setConfirmed(true)}
      />
    );
  }

  return <UploadFlow options={options} verbose={verbose} />;
};

const UploadFlow: React.FC<{ options: UploadOptions; verbose: boolean }> = ({
  options,
  verbose,
}) => {
  const { exit } = useApp();
  const {
    status,
    message,
    sendProgress,
    confirmProgress,
    currentFileIndex,
    totalFiles,
    uploadSteps,
    connectionSteps,
    scannedDevices,
    scanning,
    onDeviceSelected,
  } = useUpload(options, verbose);

  // Exit the app when done
  useEffect(() => {
    if (status === "success" || status === "error") {
      // Give time for the final render, then exit
      const timer = setTimeout(() => {
        exit();
        // Force exit since noble keeps handles open
        process.exit(status === "error" ? 1 : 0);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [status, exit]);

  return (
    <Box flexDirection="column" padding={1}>
      <Header />

      {options.isBulk && totalFiles > 1 && (
        <Box marginBottom={1}>
          <Text color="blue" bold>
            Bulk Upload: {currentFileIndex}/{totalFiles} files
          </Text>
        </Box>
      )}

      {(status === "scanning" || status === "selecting") && (
        <DeviceSelector
          devices={scannedDevices}
          scanning={scanning}
          onSelect={onDeviceSelected}
        />
      )}

      {status === "connecting" && (
        <Box flexDirection="column">
          <Box>
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            <Text color="cyan" bold>
              {" "}
              {message}
            </Text>
          </Box>
          <ConnectionStatus steps={connectionSteps} />
        </Box>
      )}

      {status === "uploading" && (
        <Box flexDirection="column">
          <UploadProgress
            status={status}
            message={message}
            sendProgress={sendProgress}
            confirmProgress={confirmProgress}
          />
          <ConnectionStatus steps={uploadSteps} />
        </Box>
      )}

      {status === "success" && (
        <>
          <UploadProgress
            status={status}
            message={message}
            sendProgress={sendProgress}
            confirmProgress={confirmProgress}
          />
          <Box marginTop={1}>
            <Text color="green">Device is ready to use!</Text>
          </Box>
        </>
      )}

      {status === "error" && (
        <>
          <UploadProgress
            status={status}
            message={message}
            sendProgress={sendProgress}
            confirmProgress={confirmProgress}
          />
          <Box marginTop={1}>
            <Text color="red">Please check your device and try again.</Text>
          </Box>
        </>
      )}
    </Box>
  );
};
