import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Keep Prisma out of the server bundle so its query engine loads correctly.
  serverExternalPackages: ["@prisma/client", "prisma"],
  // Pin the workspace root — a lockfile in a parent dir otherwise confuses Turbopack.
  turbopack: {
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
