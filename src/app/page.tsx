import { GroupGenerator } from "@/components/group-generator";

export default function Home() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Gerador de Grupos com IA</h1>
        <p className="text-muted-foreground">
          Preencha os detalhes do torneio para gerar os grupos automaticamente.
        </p>
      </div>
      <GroupGenerator />
    </div>
  );
}
