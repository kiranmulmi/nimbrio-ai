import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { listenForInstall } from './lib/installApp';
import '@fontsource-variable/inter';
import './index.css';

listenForInstall();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
