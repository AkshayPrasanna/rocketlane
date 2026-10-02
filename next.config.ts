import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  reactCompiler: true,
  typedRoutes: true,
  experimental: {
    staleTimes: {
      dynamic: 30,
    },
  },
};

export default withWorkflow(nextConfig);
