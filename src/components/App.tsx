import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import {
  Header,
  UploadProgress,
  ConnectionStatus,
} from "./index.ts";
import { useUpload } from "../hooks/useUpload.ts";
import type { UploadOptions } from "../cli/types.ts";

export interface AppProps {
  options: UploadOptions;
  verbose: boolean;
}

export const App: React.FC<AppProps> = ({ options, verbose }) => {
  const {
    status,
    message,
    progress,
    currentFileIndex,
    totalFiles,
    uploadSteps,
    connectionSteps,
  } = useUpload(options, verbose);

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
            progress={progress}
          />
          <ConnectionStatus steps={uploadSteps} />
        </Box>
      )}

      {status === "success" && (
        <>
          <UploadProgress
            status={status}
            message={message}
            progress={progress}
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
            progress={progress}
          />
          <Box marginTop={1}>
            <Text color="red">Please check your device and try again.</Text>
          </Box>
        </>
      )}
    </Box>
  );
};
