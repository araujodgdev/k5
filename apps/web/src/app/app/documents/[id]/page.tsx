import type { Metadata } from "next";
import { DocumentWorkspace } from "@/components/document/document-workspace";

export const metadata: Metadata = { title: "Documento" };

export default async function DocumentPage({ params }: PageProps<"/app/documents/[id]">) {
  const { id } = await params;
  return <DocumentWorkspace artifactId={id} variant="page" />;
}
