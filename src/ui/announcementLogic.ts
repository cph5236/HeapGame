/** Copy for the movement-rework announcement, as three beats. The refund beat
 *  is per-player, so it is omitted rather than rendered as "0 Scrap" for
 *  someone who owned none of the removed upgrades. */
export function buildAnnouncementBeats(refundAmount: number): string[] {
  const beats = [
    'Your air moves now share one Stamina pool. Air jump, dash and wall jump each cost one bar. Stamina refills fast on the ground and slowly in the air.',
    'Dash, Wall Jump and Dive are now unlocked for everyone from the start. The shop sells power, not access.',
  ];
  if (refundAmount > 0) {
    beats.push(`You had already bought some of those, so we refunded ${refundAmount.toLocaleString('en-US')} Scrap. Spend it on the new Stamina upgrades.`);
  }
  return beats;
}
