import { Command } from "commander";
import { logger, LogLevel } from "../lib/utils/logger.ts";
import { statSync } from "node:fs";
import { join, basename } from "node:path";
import { scanDirectoryForImages } from "../utils/app-utils.ts";
import type { UploadOptions, StatusOptions } from "./types.ts";
import { render } from "ink";
import { App } from "../components/App.tsx";
import { StatusApp } from "../components/StatusApp.tsx";
import { MediaDetector } from "../lib/processing/media-detector.ts";
import { BeamBoxUploader } from "../lib/core/beambox-uploader.ts";

async function runDump(options: UploadOptions, verbose: boolean) {
  if (verbose) {
    logger.setLevel(LogLevel.DEBUG);
  }

  const [width, height] = options.size.split("x").map(Number);
  const targetSize: [number, number] = [width!, height!];
  const [animationWidth, animationHeight] = options.animationSize
    .split("x")
    .map(Number);
  const animationSize: [number, number] = [animationWidth!, animationHeight!];

  const uploader = new BeamBoxUploader(
    options.address,
    undefined,
    undefined,
    undefined,
    undefined,
    verbose,
  );

  const filesToDump = options.isBulk ? (options.images ?? []) : [];
  const dumpRoot = options.dump!;

  try {
    if (options.test) {
      console.log(`Dumping checkerboard test pattern to ${dumpRoot}`);
      await uploader.uploadCheckerboard(targetSize, 8, undefined, dumpRoot);
      console.log("Dump complete. No device connection was made.");
      return;
    }

    if (filesToDump.length > 0) {
      for (const imagePath of filesToDump) {
        const fileName = basename(imagePath);
        const dumpDir = join(dumpRoot, fileName);
        console.log(`Dumping ${fileName} -> ${dumpDir}`);
        await uploader.uploadImageFromFile(
          imagePath,
          targetSize,
          animationSize,
          undefined,
          dumpDir,
        );
      }
    } else if (options.image) {
      console.log(`Dumping ${options.image} -> ${dumpRoot}`);
      await uploader.uploadImageFromFile(
        options.image,
        targetSize,
        animationSize,
        undefined,
        dumpRoot,
      );
    } else {
      console.error("Error: Either provide an image path or use --test flag");
      process.exit(1);
    }

    console.log("Dump complete. No device connection was made.");
  } catch (error) {
    console.error(`Dump failed: ${error}`);
    process.exit(1);
  }
}

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
    .option("--animation-size <size>", "Animation size WxH", "360x360")
    .option("--test", "Upload 8x8 checkerboard test pattern", false)
    .option("--packet-delay <ms>", "Delay between packets in milliseconds", "20")
    .option(
      "--dump <dir>",
      "Dry run: build the payload and write it to <dir> instead of uploading (no device connection made)",
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

      if (!sizeRegex.test(options.animationSize)) {
        console.error(
          "Error: Invalid animation size format. Use WIDTHxHEIGHT (e.g., 360x360)",
        );
        process.exit(1);
      }

      if (options.dump) {
        await runDump(options, verbose);
        return;
      }

      let confirmMediaType: "gif" | "video" | null = null;
      if (options.image && !options.test) {
        const filesToCheck = options.isBulk
          ? (options.images ?? [])
          : [options.image];

        for (const file of filesToCheck) {
          const info = await MediaDetector.detectFromFile(file).catch(
            () => null,
          );
          if (info?.type === "gif" || info?.type === "video") {
            confirmMediaType = info.type;
            break;
          }
        }
      }

      render(
        <App
          options={options}
          verbose={verbose}
          confirmMediaType={confirmMediaType}
        />,
      );
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

      render(<StatusApp options={options} verbose={verbose} />);
    });

  return program;
}
