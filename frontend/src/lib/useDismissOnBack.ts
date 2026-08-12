'use client';

import { useEffect } from 'react';

/**
 * Makes the browser/Android hardware Back button close an open overlay
 * instead of leaving the page.
 *
 * This is the back-navigation gap that actually bites on a phone. The app is
 * installed as a PWA and every full-screen surface here — the share sheet,
 * the reprint sheet, the scanner verdict — is React state, not a route. So
 * Back did what Back always does: it left the screen entirely, losing the
 * ticket the agent was mid-way through sharing. Users read that as the app
 * throwing their work away, because from the outside that is what happened.
 *
 * How it works: opening the overlay pushes one history entry. Back pops it,
 * which fires `popstate`, which closes the overlay — the page never
 * navigates. Closing by any other route (a Done button, Escape) pops that
 * entry back off so the history stack does not accumulate a dead entry per
 * open/close cycle, which would otherwise mean tapping Back several times to
 * get out of a screen the user has already closed.
 *
 * `history.state` is tagged rather than counted, so a pop that belongs to
 * some other navigation is ignored rather than mistaken for ours.
 */
export function useDismissOnBack(open: boolean, onDismiss: () => void): void {
  useEffect(() => {
    if (!open) return;
    if (typeof window === 'undefined') return;

    const marker = { __overlay: true };
    window.history.pushState(marker, '');

    let dismissedByBack = false;

    const onPop = () => {
      dismissedByBack = true;
      onDismiss();
    };

    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);

      /* Closed by a button rather than Back: our pushed entry is still on
       * the stack, so remove it. Without this, one Back press per overlay
       * the user opened and closed normally would be swallowed doing
       * nothing before they finally left the page. */
      if (!dismissedByBack) {
        const state = window.history.state as { __overlay?: boolean } | null;
        if (state?.__overlay) window.history.back();
      }
    };
  }, [open, onDismiss]);
}
