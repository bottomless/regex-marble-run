import { copy } from '../copy.ts';

const COX_ARTICLE = 'https://swtch.com/~rsc/regexp/regexp1.html';

export default function HowItWorks() {
  return (
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
  );
}
