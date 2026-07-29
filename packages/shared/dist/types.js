/* ------------------------------------------------------------------ */
/* Real-time (§10.5)                                                   */
/* ------------------------------------------------------------------ */
/** Socket.io namespace. Superuser JWT required on handshake. */
export const LIVE_NAMESPACE = '/live';
export const LIVE_EVENTS = {
    /** Coalesced batch of scan events, flushed on a 1s tick. */
    FEED: 'scan:feed',
    /** Exceptions only, emitted immediately so alerts are not delayed. */
    ALERT: 'scan:alert',
};
//# sourceMappingURL=types.js.map