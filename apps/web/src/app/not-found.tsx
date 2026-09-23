import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="page-title">Página não encontrada</h1>
      <p className="mb-3 text-muted-foreground">Confira o endereço ou volte ao início.</p>
      <Button asChild variant="outline"><Link href="/">Voltar ao início</Link></Button>
    </div>
  );
}
