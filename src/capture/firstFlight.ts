import { useUiStore } from '../store/uiStore';

/**
 * The first kept thought flies to the big picture — once.
 *
 * Writing a day or sorting a thought out ends, the first time, with the sky
 * showing where it landed: the view switches to the map, zoomed onto the new
 * stars, lit. Every capture after that stays where the person is working —
 * a flight that repeats stops being a ceremony and starts being a hijack.
 */
export function firstFlight(memoryIds: string[], delayMs = 1800): void {
  if (memoryIds.length === 0) return;
  if (localStorage.getItem('mado.ob.firstFlight')) return;
  localStorage.setItem('mado.ob.firstFlight', '1');
  setTimeout(() => {
    const ui = useUiStore.getState();
    ui.setView('map');
    ui.setHighlight(memoryIds);
    ui.requestZoomTo(memoryIds);
  }, delayMs);
}
