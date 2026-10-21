import '@fontsource/noto-sans-tagalog';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/700.css';
import '@fontsource/alegreya/700.css';
import '@fontsource/alegreya/800.css';
import './styles.css';
import { Game } from './game/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('Missing #game-canvas element.');

// The ritual circle and the telegraph draw Baybayin into canvas textures, so the font must be ready first.
await Promise.all([
  document.fonts.load('64px "Noto Sans Tagalog"', 'ᜊᜌ᜔'),
  document.fonts.load('700 16px "Alegreya Sans"'),
]).catch(() => undefined);

const game = new Game(canvas);
game.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => game.dispose());
}
