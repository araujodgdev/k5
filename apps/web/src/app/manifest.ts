import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Lume — Seu escritório",
    short_name: "Lume",
    description: "O espaço de trabalho do seu escritório.",
    lang: "pt-BR",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#171715",
    theme_color: "#20201e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Lume", url: "/app/agents" },
      { name: "Cofre", url: "/app/vault" },
      { name: "Tarefas e Agenda", url: "/app/agenda" },
    ],
  };
}
