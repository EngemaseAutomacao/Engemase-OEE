import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Pacotes do monorepo publicados como código-fonte TS (sem build próprio).
  transpilePackages: ["@engemase/contracts", "@engemase/db"],
  // Esconde o selo de ferramentas do Next.js no modo de desenvolvimento (protótipo de layout).
  devIndicators: false,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
