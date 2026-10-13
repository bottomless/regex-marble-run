import { copy } from '../copy.ts';
import Sheet from './Sheet.tsx';

const COX_ARTICLE = 'https://swtch.com/~rsc/regexp/regexp1.html';

/** The short explainer: steps, flags, why backtracking explodes, why linear-time engines do not. */
export default function HowItWorks({ onClose }: { onClose: () => void }) {
  return (
    <Sheet label={copy.howItWorksTitle} onClose={onClose} className="how-sheet">
      <header className="sheet-header">
        <h2>{copy.howItWorksTitle}</h2>
        <button type="button" className="sheet-close" aria-label={copy.sheetClose} onClick={onClose}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </header>
      <div className="how-body">
        {copy.howItWorks.map((section) => (
          <section key={section.heading}>
            <h3>{section.heading}</h3>
            <p>{section.body}</p>
          </section>
        ))}
        <footer className="how-credits">
          <p>
            {copy.credits}{' '}
            <a href={COX_ARTICLE} target="_blank" rel="noopener noreferrer">
              {copy.creditsLink}
            </a>
          </p>
        </footer>
      </div>
    </Sheet>
  );
}
