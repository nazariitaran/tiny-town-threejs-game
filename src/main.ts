import './styles.css';
import { Game } from './game/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const uiHost = document.querySelector<HTMLElement>('#ui-root');

if (!canvas || !uiHost) {
  throw new Error('Missing #game-canvas or #ui-root element.');
}

// Same task as the loading screen's first render, so nothing paints in between.
document.querySelector('#boot-splash')?.remove();
const game = new Game(canvas, uiHost);
game.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose();
  });
}
