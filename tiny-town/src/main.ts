import './styles.css';
import { Game } from './game/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const uiHost = document.querySelector<HTMLElement>('#ui-root');

if (!canvas || !uiHost) {
  throw new Error('Missing #game-canvas or #ui-root element.');
}

const game = new Game(canvas, uiHost);
game.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose();
  });
}
