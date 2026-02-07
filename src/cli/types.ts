export interface UploadOptions {
  image?: string;
  address?: string;
  size: string;
  animationSize: string;
  test: boolean;
  packetDelay: number;
  images?: string[];
  isBulk?: boolean;
}

export interface StatusOptions {
  address?: string;
  verbose: boolean;
}
