import type { Metadata } from "next";
import { DocumentEditor } from "@/components/document-editor";

export const metadata: Metadata = { title: "Editor de documento" };

export default async function DocumentPage({ params }: PageProps<"/app/documents/[id]">) {
  const { id } = await params;
  return <DocumentEditor artifactId={id} />;
}
