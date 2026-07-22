import BriefComposer from "@/components/app/BriefComposer";

export const metadata = { title: "New simulation — Microcosm" };
export const dynamic = "force-dynamic";

export default function NewSimulationPage() {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "56px 40px 90px" }}>
      <BriefComposer mode="create" />
    </div>
  );
}
