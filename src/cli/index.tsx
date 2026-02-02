import { statSync } from "node:fs";
import { Command } from "commander";
import { LogLevel, logger } from "../lib/utils/logger.ts";
import { scanDirectoryForImages } from "../utils/app-utils.ts";
import type { StatusOptions, UploadOptions } from "./types.ts";

export function setupCLI() {
  const program = new Command();

  program
    .name("beamboxctl")
    .description("CLI tool for managing BeamBox e-Badge devices")
    .version("1.0.0")
    .option("-v, --verbose", "Show detailed logs including packet data", false);

  program
    .command("upload [image]")
    .description(
      "Upload image(s) to BeamBox device (supports single file or directory for bulk upload)",
    )
    .option(
      "--image <path>",
      "Path to image file or directory (alternative to positional argument)",
    )
    .option("--address <address>", "BLE device address (optional)")
    .option("--size <size>", "Target size WxH", "368x368")
    .option("--test", "Upload 8x8 checkerboard test pattern", false)
    .option(
      "--packet-delay <ms>",
      "Delay between packets in milliseconds",
      "20",
    )
    .action(async (imageArg: string | undefined, options: UploadOptions) => {
      const globalOptions = program.opts() as { verbose: boolean };
      const verbose = globalOptions.verbose;

      if (verbose) {
        logger.setLevel(LogLevel.DEBUG);
      }

      const imagePath = imageArg || options.image;

      if (imagePath) {
        options.image = imagePath;
      }

      if (!options.test && !options.image) {
        console.error("Error: Either provide an image path or use --test flag");
        console.error(
          "Usage: beamboxctl upload <image>  or  beamboxctl upload --image <path>  or  beamboxctl upload --test",
        );
        process.exit(1);
      }

      if (options.image) {
        try {
          const stat = statSync(options.image);

          if (stat.isDirectory()) {
            const images = scanDirectoryForImages(options.image);

            if (images.length === 0) {
              console.error(
                `Error: No image files found in directory: ${options.image}`,
              );
              console.error(
                "Supported formats: .jpg, .jpeg, .png, .gif, .bmp, .webp",
              );
              process.exit(1);
            }

            console.log(`Found ${images.length} image(s) in directory`);
            options.images = images;
            options.isBulk = true;
          } else if (stat.isFile()) {
            options.isBulk = false;
          } else {
            console.error(
              `Error: Path is not a file or directory: ${options.image}`,
            );
            process.exit(1);
          }
        } catch (error) {
          console.error(`Error: Cannot access path: ${options.image}`);
          process.exit(1);
        }
      }

      const sizeRegex = /^\d+x\d+$/;
      if (!sizeRegex.test(options.size)) {
        console.error(
          "Error: Invalid size format. Use WIDTHxHEIGHT (e.g., 368x368)",
        );
        process.exit(1);
      }

      const { App } = await import("../components/App.tsx");
      const { render } = await import("ink");
      render(<App options={options} verbose={verbose} />);
    });

  program
    .command("status")
    .description("Get device status and notifications")
    .option("--address <address>", "BLE device address (optional)")
    .action(async (options: StatusOptions) => {
      const globalOptions = program.opts() as { verbose: boolean };
      const verbose = globalOptions.verbose;

      if (verbose) {
        logger.setLevel(LogLevel.DEBUG);
      }

      const { StatusApp } = await import("../components/StatusApp.tsx");
      const { render } = await import("ink");
      render(<StatusApp options={options} verbose={verbose} />);
    });

  return program;
}
