import type { NextConfig } from "next";

import { cabecalhosDeSeguranca } from "./lib/cabecalhos-seguranca";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Pacotes do monorepo publicados como código-fonte TS (sem build próprio).
  transpilePackages: ["@engemase/contracts", "@engemase/db"],
  // Esconde o selo de ferramentas do Next.js no modo de desenvolvimento (protótipo de layout).
  devIndicators: false,
  // A apresentação do produto é a página inicial; /produto continua funcionando para links antigos.
  // Não anuncia "X-Powered-By: Next.js".
  poweredByHeader: false,
  // CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy e frame-ancestors em todas as respostas.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: cabecalhosDeSeguranca({ desenvolvimento: process.env.NODE_ENV === "development" }),
      },
    ]
  },
  async redirects() {
    return [{ source: "/produto", destination: "/", permanent: true }]
  },
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
