import DrawingTool from "../../components/DrawingToolWrapper";

export const metadata = {
  title: "Verktyget — MarkKalkyl",
};

export default function VerktygetPage() {
  return (
    <main style={{ height: "100vh", overflow: "hidden" }}>
      <DrawingTool />
    </main>
  );
}
