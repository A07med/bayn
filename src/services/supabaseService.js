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

function matchSchemaErrorColumn(msg) {
  const m = String(msg).match(/Could not find the '([^']+)' column of 'matches'/i);
  return m ? m[1] : null;
}

/**
 * Older Supabase projects may lack countdown / duration columns. PostgREST returns one
 * missing-column error at a time; strip and retry until the row applies or error changes.
 */
async function withMatchesRowFallback(row, run) {
  let current = { ...row };
  let loggedPatchHint = false;
  for (let i = 0; i < 24; i++) {
    try {
      return await run(current);
    } catch (err) {
      const col = matchSchemaErrorColumn(err?.message || err?.error_description || err);
      if (col && Object.prototype.hasOwnProperty.call(current, col)) {
        if (!loggedPatchHint) {
          console.warn(
            '[matches] Omitting column(s) missing from your DB. Run `supabase-patch-matches-columns.sql` (or ALTERs in supabase-schema.sql) in the Supabase SQL Editor so game duration and countdown persist.'
          );
          loggedPatchHint = true;
        }
        const next = { ...current };
        delete next[col];
        current = next;
        continue;
      }
      throw err;
    }
  }
  throw new Error('matches: too many schema fallbacks');
}

function getTeamIdList(match) {
  const ids = [match?.teamA?.id, match?.teamB?.id]
    .map((v) => (v == null ? null : String(v)))
    .filter(Boolean);
  return Array.from(new Set(ids));
}

function buildDefaultTeamState(match) {
  return {
    currentQuestion: Number(match?.currentQuestion) || 0,
    questions: Array.isArray(match?.questions) ? match.questions : [],
    status: match?.status || 'pending',
    elapsedTime: Number(match?.elapsedTime) || 0,
    penalties: Number(match?.penalties) || 0,
    questionEndsAt: match?.questionEndsAt ?? null,
    pausedRemainingSec: match?.pausedRemainingSec ?? null,
    matchStartedAt: match?.matchStartedAt ?? null,
  };
}

function getTeamState(match, teamId) {
  if (!match || !teamId) return null;
  const key = String(teamId);
  const map = match.teamStates && typeof match.teamStates === 'object' ? match.teamStates : null;
  if (map && map[key]) return map[key];
  return buildDefaultTeamState(match);
}

function withUpdatedTeamState(match, teamId, teamStatePatch) {
  const key = String(teamId);
  const prev = getTeamState(match, teamId) || buildDefaultTeamState(match);
  const existingMap = match.teamStates && typeof match.teamStates === 'object' ? match.teamStates : {};
  return {
    ...existingMap,
    [key]: { ...prev, ...teamStatePatch },
  };
}

export async function createMatch(match) {
  const durationMin = getGameDurationMinutes(match);
  const teamIds = [match?.teamA?.id, match?.teamB?.id].filter(Boolean);
  const existingStates = match?.teamStates && typeof match.teamStates === 'object' ? match.teamStates : {};
  const initialized = { ...existingStates };
  for (const id of teamIds) {
    const k = String(id);
    initialized[k] = {
      currentQuestion: 0,
      questions: Array.isArray(initialized[k]?.questions) ? initialized[k].questions : [],
      status: 'pending',
      elapsedTime: 0,
      penalties: 0,
      questionEndsAt: null,
      pausedRemainingSec: null,
      matchStartedAt: null,
      gameDurationMinutes: durationMin,
    };
  }
  const row = denormalizeMatch({ ...match, teamStates: initialized });
  return withMatchesRowFallback(row, async (r) => {
    const { data, error } = await supabase.from('matches').insert(r).select().single();
    if (error) throw error;
    return normalizeMatch(data);
  });
}

export async function updateMatch(id, updates) {
  const row = denormalizeMatch(updates);
  await withMatchesRowFallback(row, async (r) => {
    const { error } = await supabase.from('matches').update(r).eq('id', id);
    if (error) throw error;
  });
}

/**
 * Advance to the next question only if the match is still on `answeredAtIndex`.
 * Prevents clobbering admin-driven navigation or a concurrent advance from another client.
 */
export async function advanceMatchQuestionIfCurrent(matchId, answeredAtIndex) {
  const match = await getMatch(matchId);
  if (!match) return false;
  const fallbackTeamId = getTeamIdList(match)[0];
  if (!fallbackTeamId) return false;
  return advanceTeamQuestionIfCurrent(matchId, fallbackTeamId, answeredAtIndex);
}

export async function advanceTeamQuestionIfCurrent(matchId, teamId, answeredAtIndex) {
  const match = await getMatch(matchId);
  if (!match || !teamId) return false;
  const state = getTeamState(match, teamId);
  if (!state || state.status !== 'running') return false;
  const cq = Number(state.currentQuestion) || 0;
  if (cq !== answeredAtIndex) return false;

  const questions = Array.isArray(state.questions) ? state.questions : [];
  const nextQ = answeredAtIndex + 1;
  const elapsed = wallElapsedSec(state);
  const penalties = state.penalties ?? 0;

  const teamStates =
    nextQ >= questions.length
      ? withUpdatedTeamState(match, teamId, {
          currentQuestion: nextQ,
          status: 'completed',
          elapsedTime: elapsed,
          penalties,
          questionEndsAt: null,
          pausedRemainingSec: null,
        })
      : withUpdatedTeamState(match, teamId, {
          currentQuestion: nextQ,
          elapsedTime: elapsed,
          penalties,
        });

  const allIds = getTeamIdList(match);
  const allDone =
    allIds.length > 0 &&
    allIds.every((id) => (teamStates[String(id)]?.status || 'pending') === 'completed');
  await updateMatch(matchId, {
    teamStates,
    ...(allDone ? { status: 'completed' } : {}),
  });
  return true;
}

/** End one team only when its timer reaches zero; other teams continue. */
export async function completeTeamIfRunning(matchId, teamId) {
  const match = await getMatch(matchId);
  if (!match || !teamId) return false;
  const state = getTeamState(match, teamId);
  if (!state || state.status !== 'running') return false;

  const teamStates = withUpdatedTeamState(match, teamId, {
    status: 'completed',
    questionEndsAt: null,
    pausedRemainingSec: null,
    elapsedTime: wallElapsedSec(state),
  });
  const allIds = getTeamIdList(match);
  const allDone =
    allIds.length > 0 &&
    allIds.every((id) => (teamStates[String(id)]?.status || 'pending') === 'completed');
  await updateMatch(matchId, {
    teamStates,
    ...(allDone ? { status: 'completed' } : {}),
  });
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

/**
 * Player skip: only the clicking team’s timer is penalized (their cumulative `teamSkipPenaltySec[teamId]`).
 * Does not mutate shared `question_ends_at`. Admin skip uses {@link applyMatchSkipCountdownSubtractIfCurrent}.
 */
export async function applyPlayerTeamSkipPenaltyIfCurrent(matchId, teamId, questionIndex, subtractSeconds) {
  const match = await getMatch(matchId);
  if (!match || !teamId) return false;
  const state = getTeamState(match, teamId);
  if (!state || state.status !== 'running') return false;
  const cq = Number(state.currentQuestion) || 0;
  if (cq !== questionIndex) return false;
  const sub = Math.max(0, Number(subtractSeconds) || 0);
  if (!sub) return true;
  const now = Date.now();
  const endMs = parseIsoToMs(state.questionEndsAt);
  const fullGameSec =
    (Number(state.gameDurationMinutes) || getGameDurationMinutes(match)) * 60;
  const remaining =
    endMs == null ? fullGameSec : Math.max(0, (endMs - now) / 1000);
  const newRem = Math.max(0, remaining - sub);
  const teamStates = withUpdatedTeamState(match, teamId, {
    questionEndsAt: nextQuestionEndsIso(newRem),
  });
  await updateMatch(matchId, {
    teamStates,
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
    getMatch(id)
      .then((m) => callback(m))
      .catch((err) => {
        console.error('subscribeMatch:', err);
        callback(null);
      });
  };

  safeRun();
  // Keep player/admin question transitions snappy even if realtime delivery is delayed.
  const pollMs = 100;
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
  const ts = getTeamState(match, teamId);
  if (!match || !ts || ts.status !== 'running') return;

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
  const ts = getTeamState(match, teamId);
  if (!match || !ts || ts.status !== 'running') return;

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
  const normalized = {
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
    teamSkipPenaltySec:
      row.team_skip_penalty_sec && typeof row.team_skip_penalty_sec === 'object'
        ? row.team_skip_penalty_sec
        : {},
    teamStates:
      row.team_states && typeof row.team_states === 'object'
        ? row.team_states
        : {},
  };
  const ids = [normalized.teamA?.id, normalized.teamB?.id].filter(Boolean);
  if (ids.length && (!normalized.teamStates || Object.keys(normalized.teamStates).length === 0)) {
    const fallback = buildDefaultTeamState(normalized);
    const map = {};
    for (const id of ids) map[String(id)] = { ...fallback };
    normalized.teamStates = map;
  }
  return normalized;
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
  if (obj.teamSkipPenaltySec !== undefined) row.team_skip_penalty_sec = obj.teamSkipPenaltySec;
  if (obj.teamStates !== undefined) row.team_states = obj.teamStates;
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
