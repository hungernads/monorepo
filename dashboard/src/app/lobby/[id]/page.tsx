import LobbyView from "@/components/lobby/LobbyView";

interface LobbyPageProps {
  params: Promise<{ id: string }>;
}

export default async function LobbyPage({ params }: LobbyPageProps) {
  const { id } = await params;

  return <LobbyView battleId={id} />;
}
