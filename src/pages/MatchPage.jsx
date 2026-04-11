import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  subscribeMatch,
  updateMatch,
  advanceMatchQuestionIfCurrent,
  applyMatchSkipCountdownSubtractIfCurrent,
  getMatchTeamResults,
} from '../services/supabaseService';
import {
  formatTime,
  getCountdownRemainingSec,
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
  const [match, setMatch] = useState(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [matchStatus, setMatchStatus] = useState('pending');
  const [showAnswer, setShowAnswer] = useState(false);
  const hasStartedRef = useRef(false);
  const matchRef = useRef(null);
  const countdownAdvanceLockRef = useRef(false);
  const [countdownTick, setCountdownTick] = useState(0);
  const [teamResults, setTeamResults] = useState([]);

  matchRef.current = match;

  useEffect(() => {
    const unsub = subscribeMatch(matchId, (data) => {
      setMatch(data);
      setCurrentQ(data.currentQuestion || 0);
      setMatchStatus(data.status || 'pending');
    });
    return unsub;
  }, [matchId]);

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

  /** Countdown hit zero → next question, no score change. */
  useEffect(() => {
    const m = matchRef.current;
    if (!m || m.status !== 'running' || !matchId) {
      countdownAdvanceLockRef.current = false;
      return;
    }
    const q = m.currentQuestion ?? 0;
    if (!m.questions?.[q]) return;
    const rem = getCountdownRemainingSec(m);
    if (rem > 0.15) {
      countdownAdvanceLockRef.current = false;
      return;
    }
    if (countdownAdvanceLockRef.current) return;
    countdownAdvanceLockRef.current = true;
    advanceMatchQuestionIfCurrent(matchId, q)
      .catch((e) => console.error(e))
      .finally(() => {
        countdownAdvanceLockRef.current = false;
      });
  }, [match, matchId, countdownTick]);

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
    syncToFirebase({
      status: 'completed',
      questionEndsAt: null,
      pausedRemainingSec: null,
      elapsedTime: m ? wallElapsedSec(m) : 0,
    });
    setMatchStatus('completed');
  }, [syncToFirebase]);

  const handleStart = useCallback(() => {
    hasStartedRef.current = true;
    setShowAnswer(false);
    const m = matchRef.current;
    if (!m) return;

    if (matchStatus === 'paused') {
      const rem = getCountdownRemainingSec(m);
      syncToFirebase({
        status: 'running',
        questionEndsAt: nextQuestionEndsIso(rem),
        pausedRemainingSec: null,
        elapsedTime: wallElapsedSec(m),
      });
      setMatchStatus('running');
      return;
    }

    const gameSeconds = getGameDurationMinutes(m) * 60;
    const started = m.matchStartedAt || new Date().toISOString();
    syncToFirebase({
      status: 'running',
      matchStartedAt: started,
      questionEndsAt: nextQuestionEndsIso(gameSeconds),
      pausedRemainingSec: null,
      elapsedTime: 0,
    });
    setMatchStatus('running');
  }, [matchStatus, syncToFirebase]);

  const handlePause = useCallback(() => {
    const m = matchRef.current;
    if (!m) return;
    const rem = getCountdownRemainingSec(m);
    syncToFirebase({
      status: 'paused',
      pausedRemainingSec: rem,
      questionEndsAt: null,
      elapsedTime: wallElapsedSec(m),
    });
    setMatchStatus('paused');
  }, [syncToFirebase]);

  const handleCorrect = useCallback(async () => {
    if (!match?.questions?.length) return;
    try {
      correctSound?.play();
    } catch {
      /* ignore */
    }
    setShowAnswer(false);
    await advanceMatchQuestionIfCurrent(matchId, currentQ);
  }, [match, currentQ, matchId]);

  const handleSkip = useCallback(async () => {
    if (!match?.questions?.length) return;
    try {
      skipSound?.play();
    } catch {
      /* ignore */
    }
    setShowAnswer(false);
    await applyMatchSkipCountdownSubtractIfCurrent(matchId, currentQ, SKIP_SUBTRACT_SEC);
    await advanceMatchQuestionIfCurrent(matchId, currentQ);
  }, [match, currentQ, matchId]);

  const handleReset = useCallback(() => {
    if (!confirm('Reset this match?')) return;
    hasStartedRef.current = false;
    setCurrentQ(0);
    setMatchStatus('pending');
    setShowAnswer(false);
    syncToFirebase({
      currentQuestion: 0,
      elapsedTime: 0,
      penalties: 0,
      status: 'pending',
      questionEndsAt: null,
      pausedRemainingSec: null,
      matchStartedAt: null,
    });
  }, [syncToFirebase]);

  if (!match) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="text-gray-400 text-xl">Loading match...</div>
      </div>
    );
  }

  const questions = match.questions || [];
  const question = questions[currentQ];
  const isCompleted = matchStatus === 'completed';
  const isRunning = matchStatus === 'running';
  const isPending = matchStatus === 'pending';
  const isPaused = matchStatus === 'paused';

  const remainingSec = getCountdownRemainingSec(match);

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
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 gap-6">
        {/* Countdown */}
        <div className="text-center">
          <div className="text-gray-500 text-xs mb-1 uppercase tracking-wide">Time left (whole game)</div>
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
              {formatTime(wallElapsedSec(match))}
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
                <Play size={22} /> START
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
                  <StopCircle size={22} /> End game
                </button>
              </>
            )}

            {isPaused && (
              <>
                <button
                  onClick={handleStart}
                  className="bg-green-600 hover:bg-green-700 px-8 py-4 rounded-xl text-lg font-bold transition-colors flex items-center gap-2"
                >
                  <Play size={22} /> Resume
                </button>
                <button
                  type="button"
                  onClick={handleEndGame}
                  className="bg-rose-800 hover:bg-rose-900 px-6 py-4 rounded-xl text-lg font-bold transition-colors flex items-center gap-2 border border-rose-600"
                >
                  <StopCircle size={22} /> End game
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
