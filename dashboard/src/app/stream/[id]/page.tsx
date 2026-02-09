import StreamView from "./StreamView";

interface StreamPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function StreamPage({
  params,
  searchParams,
}: StreamPageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const transparent = sp.transparent === "true" || sp.transparent === "1";
  const layout = (sp.layout as string) ?? "full";
  const showFeed = sp.feed !== "false" && sp.feed !== "0";
  const showStats = sp.stats !== "false" && sp.stats !== "0";
  const showHighlights = sp.highlights !== "false" && sp.highlights !== "0";

  return (
    <StreamView
      battleId={id}
      transparent={transparent}
      layout={layout}
      showFeed={showFeed}
      showStats={showStats}
      showHighlights={showHighlights}
    />
  );
}
