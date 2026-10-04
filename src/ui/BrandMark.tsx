/**
 * GameKit dog mark. Two shapes only so the existing brand CSS can paint them:
 * rounded ink tile + cream silhouette (eyes/nose punched out with evenodd).
 */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title ? <title>{title}</title> : null}
      <rect width="32" height="32" rx="6" />
      <path
        fillRule="evenodd"
        d="M5 7.2c-3 2-3.2 8.2.8 11.2 1.2 1 3 .8 3.6-.6C8.2 20.6 8 24 11.4 26.6c2.2 1.7 6.2 1.7 8.4 0C23.2 24 23 20.6 21.8 17.8c.6 1.4 2.4 1.6 3.6.6 4-3 3.8-9.2.8-11.2C24 5.4 20.2 4.2 16 4.2S8 5.4 5 7.2Zm7.2 8.2a1.55 1.55 0 1 0 .02 0Zm7.6 0a1.55 1.55 0 1 0 .02 0ZM16 18.4c-1.6 0-2.8 1.2-2.8 2.3 0 .7.5 1.2 1.2 1.5.8.3 1.7.4 2.5.1.7-.2 1.3-.8 1.3-1.5 0-1.1-1.2-2.4-2.2-2.4Zm-2.9 4.7c.9 1.3 1.9 1.9 2.9 1.9s2-.6 2.9-1.9c-1.8.8-4 .8-5.8 0Z"
      />
    </svg>
  );
}
