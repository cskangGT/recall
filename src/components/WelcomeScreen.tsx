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
 */
export function WelcomeScreen() {
  const dismissWelcome = useUiStore((s) => s.dismissWelcome);

  useEffect(() => {
    const el = document.querySelector<HTMLInputElement>('[data-testid="welcome-input"]');
    el?.focus();
  }, []);

  return (
    <div className="welcome" data-testid="welcome">
      <div className="welcome__stage">
        <Thinker size={146} />
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
