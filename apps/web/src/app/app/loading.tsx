import { Skeleton } from "@/components/ui/skeleton";

export default function AppLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 py-6 md:px-10 md:py-10" role="status" aria-label="Carregando página">
      <Skeleton className="h-8 w-44" />
      <div className="mt-8 grid gap-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-5/6" />
        <Skeleton className="h-12 w-2/3" />
      </div>
    </div>
  );
}
