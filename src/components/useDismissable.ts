import { useRef } from 'react';

/**
 * Click-outside-to-dismiss that survives a drag.
 *
 * The obvious versions are both wrong, and this went through both of them.
 *
 * `onPointerDown` on the backdrop closes the panel the instant you press
 * anywhere outside it — so selecting text in the input and releasing a few
 * pixels past the edge threw the panel away along with everything typed into
 * it. A gesture people make constantly.
 *
 * `onClick` on the backdrop looks like the fix and is not. When a press and a
 * release land on different elements the browser dispatches `click` at their
 * **common ancestor**, which for "started inside the panel, ended outside it"
 * is the backdrop itself. Same outcome, harder to see in the code.
 *
 * So both ends have to be checked: the press and the release must each have
 * happened on the backdrop and not on something inside it. Anything that began
 * life inside the panel is a gesture belonging to the panel, wherever it
 * finished.
 */
export function useDismissable(onDismiss: () => void) {
  const pressedOutside = useRef(false);

  return {
    onMouseDown: (e: React.MouseEvent) => {
      pressedOutside.current = e.target === e.currentTarget;
    },
    onClick: (e: React.MouseEvent) => {
      if (e.target !== e.currentTarget) return;
      if (!pressedOutside.current) return;
      onDismiss();
    },
  };
}
