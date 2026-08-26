export function EmberRule({ className = "" }: { className?: string }) {
  return <div className={`ember-line ${className}`} aria-hidden="true" />;
}
