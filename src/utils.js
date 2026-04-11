export function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function distributeQuestions(questions, numMatches) {
  const shuffled = shuffleArray(questions);
  const groups = Array.from({ length: numMatches }, () => []);
  shuffled.forEach((q, i) => {
    groups[i % numMatches].push(q);
  });
  return groups;
}

/**
 * Build multiple-choice fields from a flat question (answer + optional category).
 * If `choices` and `correctIndex` already exist, the question is returned unchanged.
 * Wrong options are sampled from `answerPool` (typically answers from the same question bank).
 */
export function enrichQuestionWithMcq(question, answerPool, numChoices = 4) {
  if (
    Array.isArray(question.choices) &&
    question.choices.length >= 2 &&
    typeof question.correctIndex === 'number'
  ) {
    return question;
  }

  const correct = String(question.answer ?? '').trim();
  const pool = (answerPool || [])
    .map((a) => String(a ?? '').trim())
    .filter((a) => a && a !== correct);

  const uniqueWrong = [];
  const seen = new Set();
  for (const a of shuffleArray(pool)) {
    if (seen.has(a)) continue;
    seen.add(a);
    uniqueWrong.push(a);
    if (uniqueWrong.length >= numChoices - 1) break;
  }

  while (uniqueWrong.length < numChoices - 1) {
    uniqueWrong.push(`خيار ${uniqueWrong.length + 1}`);
  }

  const choices = shuffleArray([correct, ...uniqueWrong.slice(0, numChoices - 1)]);
  const correctIndex = choices.findIndex((c) => c === correct);

  return {
    ...question,
    choices,
    correctIndex: correctIndex >= 0 ? correctIndex : 0,
  };
}

export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${ms}`;
}

// ── Whole-match countdown (questionEndsAt = game end wall time, pausedRemainingSec, gameDurationMinutes) ──

export function parseIsoToMs(iso) {
  if (iso == null || iso === '') return null;
  const t = typeof iso === 'string' ? Date.parse(iso) : Number(iso);
  return Number.isFinite(t) ? t : null;
}

/** Total game time budget set by admin, in minutes (countdown is shared across all questions). */
export function getGameDurationMinutes(match) {
  const v = Number(match?.gameDurationMinutes);
  return Number.isFinite(v) && v > 0 ? Math.min(24 * 60, Math.floor(v)) : 15;
}

export function nextQuestionEndsIso(secondsFromNow) {
  const s = Math.max(0, Number(secondsFromNow) || 0);
  return new Date(Date.now() + s * 1000).toISOString();
}

/** Wall-clock seconds since match_started_at (for total duration / results). */
export function wallElapsedSec(match, nowMs = Date.now()) {
  const ms = parseIsoToMs(match?.matchStartedAt);
  if (ms == null) return Number(match?.elapsedTime) || 0;
  return Math.max(0, (nowMs - ms) / 1000);
}

/** Remaining seconds on the whole-game countdown (>= 0). */
export function getCountdownRemainingSec(match, nowMs = Date.now()) {
  if (!match) return 0;
  if (match.status === 'paused') {
    const r = Number(match.pausedRemainingSec);
    return Math.max(0, Number.isFinite(r) ? r : 0);
  }
  if (match.status !== 'running') {
    return getGameDurationMinutes(match) * 60;
  }
  const endMs = parseIsoToMs(match.questionEndsAt);
  if (endMs == null) {
    return getGameDurationMinutes(match) * 60;
  }
  return Math.max(0, (endMs - nowMs) / 1000);
}
