import DebugLayout from './layout/DebugLayout.tsx';

const DEFAULT_DEBUG_PATTERN = '^(a+)+$';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') === 'layout') {
    return (
      <DebugLayout pattern={params.get('p') ?? DEFAULT_DEBUG_PATTERN} flags={params.get('flags') ?? ''} />
    );
  }
  return (
    <div id="app-root">
      <p className="app-status">regex marble run — engine ready; UI coming soon. Try ?debug=layout</p>
    </div>
  );
}
