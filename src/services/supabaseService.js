import { supabase } from '../supabase';
import { getGameDurationMinutes, nextQuestionEndsIso, wallElapsedSec, parseIsoToMs } from '../utils';

// ── Teams ──

export async function getTeams() {
  const { data, error } = await supabase.from('teams').select('*').order('created_at');
  if (error) throw error;
  return data || [];
}

export async function addTeam(team) {
  const { data, error } = await supabase.from('teams').insert(team).select().single();
  if (error) throw error;
  return data;
}

export async function updateTeam(id, updates) {
  const { error } = await supabase.from('teams').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteTeam(id) {
  const { error } = await supabase.from('teams').delete().eq('id', id);
  if (error) throw error;
}

export function subscribeTeams(callback) {
  const safeRun = () => {
    getTeams().then(callback).catch(console.error);
  };

  safeRun();
  const poll = setInterval(safeRun, 4000);

  const channel = supabase
    .channel('teams-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, safeRun)
    .subscribe();

  return () => {
    clearInterval(poll);
    supabase.removeChannel(channel);
  };
}

// ── Matches ──

export async function getMatches() {
  const { data, error } = await supabase.from('matches').select('*').order('match_number');
  if (error) throw error;
  return (data || []).map(normalizeMatch);
}

export async function getMatch(id) {
  const { data, error } = await supabase.from('matches').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? normalizeMatch(data) : null;
}

export async function createMatch(match) {
  const row = denormalizeMatch(match);
  const { data, error } = await supabase.from('matches').insert(row).select().single();
  if (error) throw error;
  return normalizeMatch(data);
}

export async function updateMatch(id, updates) {
  const row = denormalizeMatch(updates);
  const { error } = await supabase.from('matches').update(row).eq('id', id);
  if (error) throw error;
}

/**
 * Advance to the next question only if the match is still on `answeredAtIndex`.
 * Prevents clobbering admin-driven navigation or a concurrent advance from another client.
 */
export async function advanceMatchQuestionIfCurrent(matchId, answeredAtIndex) {
  const match = await getMatch(matchId);
  if (!match || match.status !== 'running') return false;
  const cq = Number(match.currentQuestion) || 0;
  if (cq !== answeredAtIndex) return false;

  const questions = match.questions || [];
  const nextQ = answeredAtIndex + 1;
  const elapsed = wallElapsedSec(match);
  const penalties = match.penalties ?? 0;

  if (nextQ >= questions.length) {
    await updateMatch(matchId, {
      currentQuestion: nextQ,
      status: 'completed',
      elapsedTime: elapsed,
      penalties,
      questionEndsAt: null,
      pausedRemainingSec: null,
    });
  } else {
    await updateMatch(matchId, {
      currentQuestion: nextQ,
      elapsedTime: elapsed,
      penalties,
    });
  }
  return true;
}

/**
 * Subtract seconds from the whole-game countdown (min remaining 0). Does not advance.
 */
export async function applyMatchSkipCountdownSubtractIfCurrent(matchId, questionIndex, subtractSeconds) {
  const match = await getMatch(matchId);
  if (!match || match.status !== 'running') return false;
  const cq = Number(match.currentQuestion) || 0;
  if (cq !== questionIndex) return false;
  const sub = Math.max(0, Number(subtractSeconds) || 0);
  if (!sub) return true;

  const now = Date.now();
  const endMs = parseIsoToMs(match.questionEndsAt);
  const fullGameSec = getGameDurationMinutes(match) * 60;
  const remaining =
    endMs == null ? fullGameSec : Math.max(0, (endMs - now) / 1000);
  const newRem = Math.max(0, remaining - sub);
  await updateMatch(matchId, {
    questionEndsAt: nextQuestionEndsIso(newRem),
  });
  return true;
}

export async function deleteMatch(id) {
  const { error } = await supabase.from('matches').delete().eq('id', id);
  if (error) throw error;
}

export function subscribeMatch(id, callback) {
  if (!id) return () => {};

  const safeRun = () => {
    getMatch(id).then((m) => m && callback(m)).catch(console.error);
  };

  safeRun();
  const pollMs = 1000;
  const poll = setInterval(safeRun, pollMs);

  const channel = supabase
    .channel(`match-${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${id}` }, safeRun)
    .subscribe();

  return () => {
    clearInterval(poll);
    supabase.removeChannel(channel);
  };
}

export function subscribeMatches(callback) {
  const safeRun = () => {
    getMatches()
      .then((data) => callback(data))
      .catch((err) => {
        console.error('subscribeMatches:', err);
        callback([]);
      });
  };

  safeRun();
  const pollMs = 1500;
  const poll = setInterval(safeRun, pollMs);

  const channel = supabase
    .channel('matches-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, safeRun)
    .subscribe();

  return () => {
    clearInterval(poll);
    supabase.removeChannel(channel);
  };
}

// ── Questions (stored in settings table) ──

export async function saveQuestions(questions) {
  const { error } = await supabase
    .from('settings')
    .upsert({ key: 'questions', value: questions }, { onConflict: 'key' });
  if (error) throw error;
}

export async function getQuestions() {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'questions')
    .maybeSingle();
  if (error) throw error;
  return data?.value || [];
}

export function subscribeQuestions(callback) {
  const safeRun = () => {
    getQuestions().then(callback).catch(console.error);
  };

  safeRun();
  const pollMs = 4000;
  const poll = setInterval(safeRun, pollMs);

  const channel = supabase
    .channel('questions-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `key=eq.questions` }, safeRun)
    .subscribe();

  return () => {
    clearInterval(poll);
    supabase.removeChannel(channel);
  };
}

// ── Per-team results (match × team scoreboard) ──

export async function getAllMatchTeamResults() {
  const { data, error } = await supabase.from('match_team_results').select('*');
  if (error) throw error;
  return (data || []).map(normalizeTeamResultRow);
}

export async function getMatchTeamResults(matchId) {
  if (!matchId) return [];
  const { data, error } = await supabase.from('match_team_results').select('*').eq('match_id', matchId);
  if (error) throw error;
  return (data || []).map(normalizeTeamResultRow);
}

/** Upsert totals after applying deltas (read-modify-write). No-op if match is not running (frozen after end). */
export async function incrementMatchTeamScore(matchId, teamId, deltaCorrect = 0, deltaWrong = 0) {
  if (!matchId || !teamId) return;
  if (!deltaCorrect && !deltaWrong) return;

  const match = await getMatch(matchId);
  if (!match || match.status !== 'running') return;

  const { data: row, error: fetchErr } = await supabase
    .from('match_team_results')
    .select('correct_count, wrong_count, skipped_count')
    .eq('match_id', matchId)
    .eq('team_id', teamId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;

  const correct = (row?.correct_count ?? 0) + deltaCorrect;
  const wrong = (row?.wrong_count ?? 0) + deltaWrong;
  const skipped = row?.skipped_count ?? 0;

  const { error } = await supabase.from('match_team_results').upsert(
    {
      match_id: matchId,
      team_id: teamId,
      correct_count: correct,
      wrong_count: wrong,
      skipped_count: skipped,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'match_id,team_id' }
  );
  if (error) throw error;
}

/** Increment skip count for a team. No-op if match is not running. */
export async function incrementMatchTeamSkip(matchId, teamId, deltaSkip = 1) {
  if (!matchId || !teamId || !deltaSkip) return;

  const match = await getMatch(matchId);
  if (!match || match.status !== 'running') return;

  const { data: row, error: fetchErr } = await supabase
    .from('match_team_results')
    .select('correct_count, wrong_count, skipped_count')
    .eq('match_id', matchId)
    .eq('team_id', teamId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;

  const correct = row?.correct_count ?? 0;
  const wrong = row?.wrong_count ?? 0;
  const skipped = (row?.skipped_count ?? 0) + deltaSkip;

  const { error } = await supabase.from('match_team_results').upsert(
    {
      match_id: matchId,
      team_id: teamId,
      correct_count: correct,
      wrong_count: wrong,
      skipped_count: skipped,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'match_id,team_id' }
  );
  if (error) throw error;
}

export async function clearMatchTeamResultsForMatches(matchIds) {
  if (!matchIds?.length) return;
  const { error } = await supabase.from('match_team_results').delete().in('match_id', matchIds);
  if (error) throw error;
}

export function subscribeAllMatchTeamResults(callback) {
  const safeRun = () => {
    getAllMatchTeamResults().then(callback).catch(console.error);
  };

  safeRun();
  const poll = setInterval(safeRun, 3000);
  const channel = supabase
    .channel('match-team-results')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_team_results' }, safeRun)
    .subscribe();

  return () => {
    clearInterval(poll);
    supabase.removeChannel(channel);
  };
}

// ── Helpers to map between app format and DB columns ──

function normalizeMatch(row) {
  return {
    id: row.id,
    teamA: row.team_a,
    teamB: row.team_b,
    questions: row.questions || [],
    currentQuestion: row.current_question ?? 0,
    status: row.status || 'pending',
    elapsedTime: row.elapsed_time ?? 0,
    penalties: row.penalties ?? 0,
    matchNumber: row.match_number ?? 0,
    gameDurationMinutes: row.game_duration_minutes ?? 15,
    questionEndsAt: row.question_ends_at ?? null,
    pausedRemainingSec: row.paused_remaining_sec ?? null,
    matchStartedAt: row.match_started_at ?? null,
  };
}

function denormalizeMatch(obj) {
  const row = {};
  if (obj.teamA !== undefined) row.team_a = obj.teamA;
  if (obj.teamB !== undefined) row.team_b = obj.teamB;
  if (obj.questions !== undefined) row.questions = obj.questions;
  if (obj.currentQuestion !== undefined) row.current_question = obj.currentQuestion;
  if (obj.status !== undefined) row.status = obj.status;
  if (obj.elapsedTime !== undefined) row.elapsed_time = obj.elapsedTime;
  if (obj.penalties !== undefined) row.penalties = obj.penalties;
  if (obj.matchNumber !== undefined) row.match_number = obj.matchNumber;
  if (obj.gameDurationMinutes !== undefined) row.game_duration_minutes = obj.gameDurationMinutes;
  if (obj.questionEndsAt !== undefined) row.question_ends_at = obj.questionEndsAt;
  if (obj.pausedRemainingSec !== undefined) row.paused_remaining_sec = obj.pausedRemainingSec;
  if (obj.matchStartedAt !== undefined) row.match_started_at = obj.matchStartedAt;
  return row;
}

function normalizeTeamResultRow(r) {
  return {
    id: r.id,
    matchId: r.match_id,
    teamId: r.team_id,
    correctCount: r.correct_count ?? 0,
    wrongCount: r.wrong_count ?? 0,
    skippedCount: r.skipped_count ?? 0,
    updatedAt: r.updated_at,
  };
}
