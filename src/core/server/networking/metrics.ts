/** Process-wide counters, exposed via GET /stats for the load-test tool. */
export const metrics = {
  msgsIn: 0,
  msgsOut: 0,
  bytesIn: 0,
  bytesOut: 0,
  rejected: 0,
  droppedFrames: 0,
};

export function resetMetrics(): void {
  metrics.msgsIn = 0;
  metrics.msgsOut = 0;
  metrics.bytesIn = 0;
  metrics.bytesOut = 0;
  metrics.rejected = 0;
  metrics.droppedFrames = 0;
}
