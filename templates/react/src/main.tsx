import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

// No <StrictMode>: its development-only double effect would create two SDK
// instances and two loops. Add your own HMR guard if you need one.
createRoot(container).render(<App />);
