import { ThemeToggle } from './bits';

/** The top bar for the secondary pages (/?eval, /?spike): brand, a way home, the theme toggle. */
export function PageTop() {
  return (
    <header className="top">
      <a className="brand" href={import.meta.env.BASE_URL} aria-label="OneOf home"><span className="mark" aria-hidden>1/</span><span className="word">OneOf</span></a>
      <div className="top-fill" />
      <a className="cell" href={import.meta.env.BASE_URL}>Back to OneOf</a>
      <ThemeToggle />
    </header>
  );
}
