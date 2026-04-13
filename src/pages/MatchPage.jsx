import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  subscribeMatch,
  updateMatch,
  advanceTeamQuestionIfCurrent,
  completeTeamIfRunning,
  applyPlayerTeamSkipPenaltyIfCurrent,
  getMatchTeamResults,
} from '../services/supabaseService';
import {
  formatTime,
  getCountdownRemainingSecForTeam,
  getMatchTeamState,
  getGameDurationMinutes,
  nextQuestionEndsIso,
  wallElapsedSec,
} from '../utils';
import TimerDisplay from '../components/TimerDisplay';
import {
  Play, Pause, SkipForward, CheckCircle,
  Trophy, RotateCcw, StopCircle,
} from 'lucide-react';

const SKIP_SUBTRACT_SEC = 10;

const correctSound = typeof Audio !== 'undefined' ? new Audio('data:audio/wav;base64,UklGRl4FAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YToFAACAgICAgICAgICAgICAgICA/f8DAP3/AwD9/wMA/f8DAP3/AwD6/wYA+v8GAPoABgD6/wYA+v8GAPf/CQD3/wkA9/8JAPf/CQD3/wkA9P8MAP7/AgD+/wIA') : null;
const skipSound = typeof Audio !== 'undefined' ? new Audio('data:audio/wav;base64,UklGRl4FAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YToFAACAgICAgIC//wEA//8BAP//AQD//wEA/v8CAP7/AgD+/wIA/v8CAP3/AwD9/wMA/f8DAP3/AwD8/wQA') : null;

export default function MatchPage() {
  const { matchId } = useParams();
  /** undefined = loading; null = not found / error */
  const [match, setMatch] = useState(undefined);
  const [currentQ, setCurrentQ] = useState(0);
  const [matchStatus, setMatchStatus] = useState('pending');
  const [showAnswer, setShowAnswer] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const selectedTeamIdRef = useRef(null);
  const hasStartedRef = useRef(false);
  const matchRef = useRef(null);
  const countdownAdvanceLockRef = useRef(false);
  const [countdownTick, setCountdownTick] = useState(0);
  const [teamResults, setTeamResults] = useState([]);

  matchRef.current = match;
  selectedTeamIdRef.current = selectedTeamId;

  useEffect(() => {
    setMatch(undefined);
    if (!matchId) {
      setMatch(null);
      return undefined;
    }
    const unsub = subscribeMatch(matchId, (data) => {
      setMatch(data);
      if (data) {
        const ids = [data.teamA?.id, data.teamB?.id].filter(Boolean).map((v) => String(v));
        setSelectedTeamId((prev) => {
          const sticky = selectedTeamIdRef.current;
          if (sticky && ids.includes(String(sticky))) return String(sticky);
          if (prev && ids.includes(String(prev))) return String(prev);
          return ids[0] || null;
        });
      }
    });
    return unsub;
  }, [matchId]);

  useEffect(() => {
    if (!match || !selectedTeamId) return;
    const ts = getMatchTeamState(match, selectedTeamId);
    setCurrentQ(ts?.currentQuestion || 0);
    setMatchStatus(ts?.status || 'pending');
  }, [match, selectedTeamId]);

  const syncToFirebase = useCallback(async (updates) => {
    try {
      await updateMatch(matchId, updates);
    } catch (err) {
      console.error('Sync error:', err);
    }
  }, [matchId]);

  useEffect(() => {
    if (matchStatus !== 'running' && matchStatus !== 'paused') return;
    const id = setInterval(() => setCountdownTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [matchStatus]);

  /** Wall-clock match duration for results / live (admin is source of truth while running). */
  useEffect(() => {
    if (matchStatus !== 'running' || !matchId) return;
    const id = setInterval(() => {
      const m = matchRef.current;
      if (!m?.matchStartedAt) return;
      syncToFirebase({ elapsedTime: wallElapsedSec(m) });
    }, 1000);
    return () => clearInterval(id);
  }, [matchStatus, matchId, syncToFirebase]);

  /** Countdown hit zero → end selected team only, no effect on other teams. */
  useEffect(() => {
    const m = matchRef.current;
    if (!m || !selectedTeamId || !matchId) {
      countdownAdvanceLockRef.current = false;
      return;
    }
    const ts = getMatchTeamState(m, selectedTeamId);
    if (!ts || ts.status !== 'running') {
      countdownAdvanceLockRef.current = false;
      return;
    }
    const rem = getCountdownRemainingSecForTeam(m, selectedTeamId);
    if (rem > 0.15) {
      countdownAdvanceLockRef.current = false;
      return;
    }
    if (countdownAdvanceLockRef.current) return;
    countdownAdvanceLockRef.current = true;
    completeTeamIfRunning(matchId, selectedTeamId)
      .catch((e) => console.error(e))
      .finally(() => {
        countdownAdvanceLockRef.current = false;
      });
  }, [match, matchId, selectedTeamId, countdownTick]);

  useEffect(() => {
    if (!matchId || match?.status !== 'completed') {
      setTeamResults([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      getMatchTeamResults(matchId)
        .then((rows) => {
          if (!cancelled) setTeamResults(rows);
        })
        .catch(console.error);
    };
    load();
    const id = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [matchId, match?.status]);

  const handleEndGame = useCallback(() => {
    if (!confirm('End match now for all players? No more answers or skips.')) return;
    const m = matchRef.current;
    if (!m) return;
    const ids = [m.teamA?.id, m.teamB?.id].filter(Boolean).map((v) => String(v));
    const teamStates = { ...(m.teamStates || {}) };
    for (const id of ids) {
      const ts = getMatchTeamState(m, id);
      teamStates[id] = {
        ...ts,
        status: 'completed',
        questionEndsAt: null,
        pausedRemainingSec: null,
        elapsedTime: ts ? wallElapsedSec(ts) : 0,
      };
    }
    syncToFirebase({
      status: 'completed',
      teamStates,
    });
    setMatchStatus('completed');
  }, [syncToFirebase]);

  const handleStart = useCallback(() => {
    hasStartedRef.current = true;
    setShowAnswer(false);
    const m = matchRef.current;
    if (!m) return;
    const ids = [m.teamA?.id, m.teamB?.id].filter(Boolean).map((v) => String(v));
    const nowIso = new Date().toISOString();
    const teamStates = { ...(m.teamStates || {}) };
    for (const id of ids) {
      const ts = getMatchTeamState(m, id);
      const rem =
        ts?.status === 'paused'
          ? Math.max(0, Number(ts?.pausedRemainingSec) || 0)
          : getGameDurationMinutes(m) * 60;
      const started = ts?.matchStartedAt || nowIso;
      teamStates[id] = {
        ...ts,
        status: 'running',
        questionEndsAt: nextQuestionEndsIso(rem),
        pausedRemainingSec: null,
        matchStartedAt: started,
        elapsedTime: ts?.status === 'paused' ? wallElapsedSec(ts) : 0,
      };
    }
    syncToFirebase({ teamStates, status: 'running' });
    setMatchStatus('running');
  }, [syncToFirebase]);

  const handlePause = useCallback(() => {
    const m = matchRef.current;
    if (!m || !selectedTeamId) return;
    const ts = getMatchTeamState(m, selectedTeamId);
    if (!ts) return;
    const rem = getCountdownRemainingSecForTeam(m, selectedTeamId);
    const teamStates = {
      ...(m.teamStates || {}),
      [String(selectedTeamId)]: {
        ...ts,
        status: 'paused',
        pausedRemainingSec: rem,
        questionEndsAt: null,
        elapsedTime: wallElapsedSec(ts),
      },
    };
    syncToFirebase({ teamStates });
    setMatchStatus('paused');
  }, [selectedTeamId, syncToFirebase]);

  const handleCorrect = useCallback(async () => {
    if (!selectedTeamId) return;
    const ts = getMatchTeamState(match, selectedTeamId);
    if (!ts?.questions?.length) return;
    try {
      correctSound?.play();
    } catch {
      /* ignore */
    }
    setShowAnswer(false);
    await advanceTeamQuestionIfCurrent(matchId, selectedTeamId, currentQ);
  }, [match, currentQ, matchId, selectedTeamId]);

  const handleSkip = useCallback(async () => {
    if (!selectedTeamId) return;
    const ts = getMatchTeamState(match, selectedTeamId);
    if (!ts?.questions?.length) return;
    try {
      skipSound?.play();
    } catch {
      /* ignore */
    }
    setShowAnswer(false);
    await applyPlayerTeamSkipPenaltyIfCurrent(matchId, selectedTeamId, currentQ, SKIP_SUBTRACT_SEC);
    await advanceTeamQuestionIfCurrent(matchId, selectedTeamId, currentQ);
  }, [match, currentQ, matchId, selectedTeamId]);

  const handleReset = useCallback(() => {
    if (!confirm('Reset this match?')) return;
    hasStartedRef.current = false;
    setCurrentQ(0);
    setMatchStatus('pending');
    setShowAnswer(false);
    const m = matchRef.current;
    if (!m) return;
    const teamStates = { ...(m.teamStates || {}) };
    const ids = [m.teamA?.id, m.teamB?.id].filter(Boolean).map((v) => String(v));
    for (const id of ids) {
      const prev = getMatchTeamState(m, id);
      teamStates[id] = {
        ...prev,
        currentQuestion: 0,
        status: 'pending',
        elapsedTime: 0,
        penalties: 0,
        questionEndsAt: null,
        pausedRemainingSec: null,
        matchStartedAt: null,
      };
    }
    syncToFirebase({
      status: 'pending',
      teamStates,
    });
  }, [syncToFirebase]);

  if (match === undefined) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="text-gray-400 text-xl">Loading match...</div>
      </div>
    );
  }

  if (match === null) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 h-screen bg-gray-950 px-4">
        <p className="text-gray-400 text-center max-w-md">Match not found or could not be loaded.</p>
        <Link to="/admin" className="text-indigo-400 hover:text-indigo-300 underline text-sm">
          Back to Admin
        </Link>
      </div>
    );
  }

  const currentTeamState = selectedTeamId ? getMatchTeamState(match, selectedTeamId) : null;
  const questions = currentTeamState?.questions || [];
  const question = questions[currentQ];
  const isCompleted = matchStatus === 'completed' || match.status === 'completed';
  const isRunning = matchStatus === 'running';
  const isPending = matchStatus === 'pending';
  const isPaused = matchStatus === 'paused';

  const remainingSec = selectedTeamId
    ? getCountdownRemainingSecForTeam(match, selectedTeamId)
    : 0;

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="bg-indigo-600 text-white text-xs font-bold px-2 py-1 rounded">
              MATCH #{match.matchNumber}
            </span>
            <span className={`text-xs px-2 py-1 rounded font-medium ${
              isCompleted ? 'bg-green-900 text-green-400' :
              isRunning ? 'bg-blue-900 text-blue-400 animate-pulse' :
              isPaused ? 'bg-yellow-900 text-yellow-400' :
              'bg-gray-800 text-gray-400'
            }`}>
              {matchStatus.toUpperCase()}
            </span>
            <span className="text-xs text-gray-500">
              {getGameDurationMinutes(match)} min game
            </span>
            {selectedTeamId && (
              <span className="text-xs text-indigo-300 bg-indigo-900/40 px-2 py-1 rounded">
                Team scope: {selectedTeamId === String(match.teamA?.id) ? match.teamA?.name : match.teamB?.name}
              </span>
            )}
          </div>
          <button
            onClick={handleReset}
            className="text-gray-400 hover:text-yellow-400 transition-colors flex items-center gap-1 text-sm"
          >
            <RotateCcw size={14} /> Reset
          </button>
        </div>
      </div>

      {/* Teams */}
      <div className="bg-gray-900/50 px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-center gap-6">
          <div className="text-right flex-1">
            <div className="text-2xl font-bold text-blue-400">{match.teamA?.name}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {match.teamA?.players?.join(' · ')}
            </div>
          </div>
          <div className="text-gray-600 text-2xl font-bold">VS</div>
          <div className="text-left flex-1">
            <div className="text-2xl font-bold text-red-400">{match.teamB?.name}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {match.teamB?.players?.join(' · ')}
            </div>
          </div>
        </div>
        <div className="max-w-4xl mx-auto mt-4 flex items-center justify-center gap-2">
          {[match.teamA, match.teamB].filter(Boolean).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                const id = String(t.id);
                selectedTeamIdRef.current = id;
                setSelectedTeamId(id);
                const ts = getMatchTeamState(matchRef.current, id);
                setCurrentQ(ts?.currentQuestion || 0);
                setMatchStatus(ts?.status || 'pending');
                setShowAnswer(false);
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                String(selectedTeamId) === String(t.id)
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Control {t.name}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 gap-6">
        {/* Countdown */}
        <div className="text-center">
          <div className="text-gray-500 text-xs mb-1 uppercase tracking-wide">Time left (whole game)</div>
          <div className="text-gray-600 text-[11px] mb-2 uppercase tracking-wide">selected team timer</div>
          <TimerDisplay
            seconds={isCompleted ? 0 : remainingSec}
            isRunning={isRunning}
            large
          />
        </div>

        {/* Question */}
        {isCompleted ? (
          <div className="bg-gray-900 border border-green-800 rounded-2xl p-8 max-w-2xl w-full">
            <Trophy className="mx-auto mb-4 text-yellow-400" size={48} />
            <h2 className="text-2xl font-bold text-green-400 mb-2 text-center">Match Complete!</h2>
            <p className="text-4xl font-mono font-bold text-white mb-2 text-center">
              {formatTime(wallElapsedSec(currentTeamState || match))}
            </p>
            <p className="text-gray-400 text-center mb-6">
              {questions.length} questions · total time
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              {[match.teamA, match.teamB].map((t) => {
                if (!t?.id) return null;
                const r = teamResults.find((x) => x.teamId === t.id);
                const c = r?.correctCount ?? 0;
                const w = r?.wrongCount ?? 0;
                const s = r?.skippedCount ?? 0;
                const answered = c + w;
                const attempted = answered + s;
                const isA = t.id === match.teamA?.id;
                return (
                  <div
                    key={t.id}
                    className={`rounded-xl border p-4 ${
                      isA ? 'border-blue-800 bg-blue-950/30' : 'border-red-800 bg-red-950/30'
                    }`}
                  >
                    <div className={`font-bold mb-2 ${isA ? 'text-blue-300' : 'text-red-300'}`}>
                      {t.name}
                    </div>
                    <ul className="space-y-1 text-gray-300">
                      <li>Answered (correct + wrong): {answered}</li>
                      <li className="text-green-400">Correct: {c}</li>
                      <li className="text-red-400">Wrong: {w}</li>
                      <li className="text-amber-200">Skipped: {s}</li>
                      <li className="text-gray-400 pt-1 border-t border-gray-700">
                        Total attempted: {attempted}
                      </li>
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        ) : question ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 max-w-2xl w-full">
            <div className="text-center mb-2">
              <span className="text-gray-500 text-sm">
                Question {currentQ + 1} / {questions.length}
              </span>
              <div className="w-full bg-gray-800 rounded-full h-1.5 mt-2">
                <div
                  className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${((currentQ + 1) / questions.length) * 100}%` }}
                />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-white text-center mt-4">
              {question.question}
            </h2>
            {Array.isArray(question.choices) && question.choices.length >= 2 && (
              <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 text-left max-w-xl mx-auto">
                {question.choices.map((c, idx) => (
                  <li
                    key={idx}
                    className={`rounded-lg px-3 py-2 text-sm ${
                      showAnswer && idx === question.correctIndex
                        ? 'bg-green-900/40 border border-green-600 text-green-200'
                        : 'bg-gray-800/80 border border-gray-700 text-gray-300'
                    }`}
                  >
                    <span className="text-gray-500 mr-2">{idx + 1}.</span>
                    {c}
                  </li>
                ))}
              </ul>
            )}
            {showAnswer && (
              <div className="mt-4 bg-green-900/30 border border-green-800 rounded-xl p-4 text-center">
                <div className="text-green-400 text-lg font-semibold">{question.answer}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 max-w-2xl w-full text-center text-gray-500">
            No questions assigned to this match
          </div>
        )}

        {/* Controls */}
        {!isCompleted && (
          <div className="flex flex-wrap gap-3 justify-center">
            {isPending && (
              <button
                onClick={handleStart}
                disabled={!questions.length}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed px-8 py-4 rounded-xl text-lg font-bold transition-colors flex items-center gap-2"
              >
                <Play size={22} /> START (ALL TEAMS)
              </button>
            )}

            {isRunning && (
              <>
                <button
                  onClick={handlePause}
                  className="bg-yellow-600 hover:bg-yellow-700 px-6 py-4 rounded-xl text-lg font-bold transition-colors flex items-center gap-2"
                >
                  <Pause size={22} /> Pause
                </button>
                <button
                  onClick={() => setShowAnswer((v) => !v)}
                  className="bg-gray-700 hover:bg-gray-600 px-6 py-4 rounded-xl text-lg font-bold transition-colors flex items-center gap-2"
                >
                  {showAnswer ? 'Hide Answer' : 'Show Answer'}
                </button>
                <button
                  onClick={handleCorrect}
                  className="bg-green-600 hover:bg-green-700 px-6 py-4 rounded-xl text-lg font-bold transition-colors flex items-center gap-2"
                >
                  <CheckCircle size={22} /> Correct
                </button>
                <button
                  onClick={handleSkip}
                  className="bg-red-600 hover:bg-red-700 px-6 py-4 rounded-xl text-lg font-bold transition-colors flex items-center gap-2"
                >
                  <SkipForward size={22} /> Skip (−{SKIP_SUBTRACT_SEC}s)
                </button>
                <button
                  type="button"
                  onClick={handleEndGame}
                  className="bg-rose-800 hover:bg-rose-900 px-6 py-4 rounded-xl text-lg font-bold transition-colors flex items-center gap-2 border border-rose-600"
                >
                  <StopCircle size={22} /> End game (ALL)
                </button>
              </>
            )}

            {isPaused && (
              <>
                <button
                  onClick={handleStart}
                  className="bg-green-600 hover:bg-green-700 px-8 py-4 rounded-xl text-lg font-bold transition-colors flex items-center gap-2"
                >
                  <Play size={22} /> Resume (ALL TEAMS)
                </button>
                <button
                  type="button"
                  onClick={handleEndGame}
                  className="bg-rose-800 hover:bg-rose-900 px-6 py-4 rounded-xl text-lg font-bold transition-colors flex items-center gap-2 border border-rose-600"
                >
                  <StopCircle size={22} /> End game (ALL)
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
