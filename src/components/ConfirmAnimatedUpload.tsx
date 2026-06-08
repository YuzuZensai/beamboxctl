import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Header } from "./Header.tsx";

export interface ConfirmAnimatedUploadProps {
  mediaType: "gif" | "video";
  onConfirm: () => void;
}

const CONFIRM_PHRASE = "YES";

export const ConfirmAnimatedUpload: React.FC<ConfirmAnimatedUploadProps> = ({
  mediaType,
  onConfirm,
}) => {
  const { exit } = useApp();
  const [input, setInput] = useState("");

  useInput((char, key) => {
    if (key.escape || (key.ctrl && char === "c")) {
      exit();
      process.exit(1);
    }

    if (key.return) {
      if (input === CONFIRM_PHRASE) {
        onConfirm();
      }
      return;
    }

    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    if (char) {
      setInput((prev) => prev + char);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header />

      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text color="red" bold>
          WARNING: Uploading {mediaType} to your BeamBox device is EXPERIMENTAL.
        </Text>
        <Text color="red">
          There are known cases where this can permanently brick your device.
        </Text>
        <Text color="red">Proceed only if you understand and accept this risk.</Text>
      </Box>

      <Box marginTop={1}>
        <Text>
          Type "{CONFIRM_PHRASE}" to continue (Esc to cancel): {input}
        </Text>
      </Box>
    </Box>
  );
};
