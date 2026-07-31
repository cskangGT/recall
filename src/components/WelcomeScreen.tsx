import { useEffect } from 'react';
import { useUiStore } from '../store/uiStore';
import { Thinker } from './Thinker';
import { Composer } from './Composer';

/**
 * The first thing Recall says.
 *
 * A conversation, not a splash: the product is a dialogue with your own memory,
 * so the opening frame is a chat window and the first thing you type is a real
 * question, not a door you have to knock on. The same composer stays docked at
 * the bottom of the browsing screen afterwards, so the conversation never ends —
 * it just moves down.
 *
 * The scene around it is a night sky over a hill, with the figure sitting on the
 * crest. Everything about it lives in CSS on `.welcome` — see the note there for
 * why the sky is dark overhead and pale at the horizon rather than the other way
 * round. Here there is only the markup the gradients cannot express: the hill,
 * four stars, and where the figure stands.
 */

/**
 * Four, placed by hand. Evenly scattered stars read as a texture; a few in an
 * uneven grouping, one of them clearly brightest, reads as a night sky.
 */
const STARS = [
  { left: '77%', top: '17%', size: 3.4, opacity: 0.95 },
  { left: '88%', top: '25%', size: 2.1, opacity: 0.6 },
  { left: '60%', top: '35%', size: 1.8, opacity: 0.5 },
  { left: '64%', top: '43%', size: 1.6, opacity: 0.42 },
];
export function WelcomeScreen() {
  const dismissWelcome = useUiStore((s) => s.dismissWelcome);

  useEffect(() => {
    const el = document.querySelector<HTMLInputElement>('[data-testid="welcome-input"]');
    el?.focus();
  }, []);

  return (
    <div className="welcome" data-testid="welcome">
      {STARS.map((s) => (
        <span
          key={s.left + s.top}
          className="welcome__star"
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            opacity: s.opacity,
          }}
        />
      ))}

      <div className="welcome__hill" />

      <div className="welcome__stage">
        <Thinker size={124} />
      </div>

      <div className="welcome__chat">
        <p className="welcome__bubble">
          Want to think something through?
          <span className="welcome__aside">
            Everything you've saved is already sorted. Ask me anything about it — or just
            press Enter to look around.
          </span>
        </p>

        <Composer variant="welcome" onSubmitted={dismissWelcome} />
      </div>
    </div>
  );
}
