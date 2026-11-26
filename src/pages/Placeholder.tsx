export default function Placeholder({ title, step }: { title: string; step: string }) {
  return (
    <div>
      <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-muted">Coming in {step}.</p>
    </div>
  );
}