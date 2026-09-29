import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/termos-de-uso", "/politica-privacidade"].map(path => ({
    url: `https://lume.software${path}`,
  }));
}
