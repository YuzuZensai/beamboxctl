export interface UploadOptions {
  image?: string;
  address?: string;
  size: string;
  animationSize: string;
  test: boolean;
  packetDelay: number;
  images?: string[];
  isBulk?: boolean;
  dump?: string;
}

export interface StatusOptions {
  address?: string;
  verbose: boolean;
}
