// The compactions of the session: how many the main agent made, and the stamina the next measurement is
// compared with. In memory with the tracker and gone with the session; nothing here is ever stored or traced.
export type Compactions = {
  count: number
  // A compaction whose recovery has not been seen yet: the stamina known before it (null when none was known).
  // The compaction event does not carry the new percentage, so the message waits for the next measurement.
  pending: { before: number | null } | null
}

export const NO_COMPACTIONS: Compactions = { count: 0, pending: null }

export type CompactionEvent = {
  // What compacts (`session.compact`'s trigger).
  trigger: string
  // Present when a subagent (or a fork of the engine) compacts its own transcript.
  agentId?: string
  // A hook vetoed it: the conversation stayed as it was.
  skipped: boolean
}

// Only the person's `/compact` and the engine's own threshold count, and only for the main agent; a
// `precompute` installs nothing and a veto compacts nothing.
export const countsAsCompaction = (event: CompactionEvent): boolean =>
  event.agentId === undefined && !event.skipped && (event.trigger === 'manual' || event.trigger === 'auto')

// One more compaction. Another one before any measurement keeps the first "before": it is the stamina
// the guild had before resting.
export const onCompaction = (state: Compactions, before: number | null): Compactions => ({
  count: state.count + 1,
  pending: state.pending ?? { before },
})

export type Announcement = { before: number; after: number }

// A measurement of the stamina (percent left; null when the engine had none). It closes the pending compaction
// when the stamina went up (the message), or down (the compaction did not help: nothing to say). An equal figure
// may be the engine's old reading, so the compaction stays pending for the next one.
export const onStamina = (state: Compactions, after: number | null): { state: Compactions; announce?: Announcement } => {
  if (state.pending === null || after === null) return { state }

  const { before } = state.pending
  if (before !== null && after === before) return { state }

  const closed: Compactions = { count: state.count, pending: null }

  return before !== null && after > before ? { state: closed, announce: { before, after } } : { state: closed }
}

export const compactionToast = (announce: Announcement): string =>
  `A guilda descansou: ST recuperada de ${announce.before}% para ${announce.after}%`

// `1 compactação`, `2 compactações`; none while there are none. `short` gives `2 compact.` for a line without room.
export const compactionSegments = (count: number, short = false): string[] =>
  !(count > 0) ? [] : short ? [`${count} compact.`] : [`${count} ${count === 1 ? 'compactação' : 'compactações'}`]
