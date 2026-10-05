import './styles.css';
import { Game } from './game/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const uiHost = document.querySelector<HTMLElement>('#ui-root');

if (!canvas || !uiHost) {
  throw new Error('Missing #game-canvas or #ui-root element.');
}

const game = new Game(canvas, uiHost);
game.start();

// Experimental hands-free controls: only with ?gestures, and only then is any of it (or MediaPipe) loaded.
const gestures = new URLSearchParams(window.location.search).get('gestures');
let disposeHandsFree: (() => void) | null = null;
if (gestures !== null) {
  void import('./gesture/HandsFree').then(({ installHandsFree }) => {
    disposeHandsFree = installHandsFree(game.bus, canvas, gestures);
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeHandsFree?.();
    game.dispose();
  });
}
