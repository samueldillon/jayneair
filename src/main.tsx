import { render } from 'preact';
import { App } from './App';
import './lib/theme';
import './styles/global.css';

render(<App />, document.getElementById('app')!);
