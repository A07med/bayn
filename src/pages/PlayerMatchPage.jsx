import { useState, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  subscribeMatch,
  incrementMatchTeamScore,
  incrementMatchTeamSkip,
  getMatchTeamResults,
  advanceTeamQuestionIfCurrent,
  completeTeamIfRunning,
  applyPlayerTeamSkipPenaltyIfCurrent,
} from '../services/supabaseService';
import { formatTime, getCountdownRemainingSecForTeam, getMatchTeamState, wallElapsedSec } from '../utils';
import { Trophy, Clock, Zap, Users, CheckCircle2, XCircle, SkipForward } from 'lucide-react';

/** Seconds removed from countdown on skip (same magnitude as admin Skip) */
const SKIP_SUBTRACT_SEC = 10;
const NEXT_QUESTION_DELAY_MS = 70;

function teamStorageKey(matchId) {
  return `arena_play_team_${matchId}`;
}

export default function PlayerMatchPage() {
  const { matchId } = useParams();
  /** undefined = still loading; null = missing or failed to load */
  const [match, setMatch] = useState(undefined);
  const [teamPick, setTeamPick] = useState(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [isCorrect, setIsCorrect] = useState(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [localCurrentQ, setLocalCurrentQ] = useState(null);
  const advanceTimeoutRef = useRef(null);
  const choiceLockedRef = useRef(false);
  const countdownAdvanceLockRef = useRef(false);
  const matchRef = useRef(null);
  matchRef.current = match;

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = sessionStorage.getItem(teamStorageKey(matchId));
        setTeamPick(raw ? JSON.parse(raw) : null);
      } catch {
        setTeamPick(null);
      }
    });
  }, [matchId]);

  useEffect(() => {
    setMatch(undefined);
    if (!matchId) {
      setMatch(null);
      return undefined;
    }
    const unsub = subscribeMatch(matchId, setMatch);
    return unsub;
  }, [matchId]);

  const teamState = teamPick?.teamId ? getMatchTeamState(match, teamPick.teamId) : null;
  const remoteCurrentQ = teamState?.currentQuestion ?? 0;
  const currentQ = localCurrentQ ?? remoteCurrentQ;

  useEffect(() => {
    if (localCurrentQ == null) return;
    if (remoteCurrentQ >= localCurrentQ) {
      setLocalCurrentQ(null);
    }
  }, [localCurrentQ, remoteCurrentQ]);

  useEffect(() => {
    if (advanceTimeoutRef.current) {
      clearTimeout(advanceTimeoutRef.current);
      advanceTimeoutRef.current = null;
    }
    queueMicrotask(() => {
      setSelectedAnswer(null);
      setIsCorrect(null);
      setIsAnswered(false);
      choiceLockedRef.current = false;
    });
  }, [currentQ]);

  useEffect(() => () => {
    if (advanceTimeoutRef.current) {
      clearTimeout(advanceTimeoutRef.current);
      advanceTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!matchId || !teamPick?.teamId) return;
    getMatchTeamResults(matchId)
      .then((rows) => {
        const r = rows.find((x) => x.teamId === teamPick.teamId);
        if (r) {
          setCorrectCount(r.correctCount);
          setWrongCount(r.wrongCount);
          setSkippedCount(r.skippedCount ?? 0);
        }
      })
      .catch(console.error);
  }, [matchId, teamPick?.teamId, match?.status]);

  const [countdownTick, setCountdownTick] = useState(0);

  useEffect(() => {
    const s = teamState?.status;
    if (s !== 'running' && s !== 'paused') return;
    const id = setInterval(() => setCountdownTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [teamState?.status]);

  /** Countdown → 0: end this team only (other teams continue). */
  useEffect(() => {
    const m = matchRef.current;
    if (!m || !teamPick?.teamId || !matchId) {
      countdownAdvanceLockRef.current = false;
      return;
    }
    const ts = getMatchTeamState(m, teamPick.teamId);
    if (!ts || ts.status !== 'running') {
      countdownAdvanceLockRef.current = false;
      return;
    }
    const rem = getCountdownRemainingSecForTeam(m, teamPick.teamId);
    if (rem > 0.15) {
      countdownAdvanceLockRef.current = false;
      return;
    }
    if (countdownAdvanceLockRef.current) return;
    countdownAdvanceLockRef.current = true;
    completeTeamIfRunning(matchId, teamPick.teamId)
      .catch((e) => console.error(e))
      .finally(() => {
        countdownAdvanceLockRef.current = false;
      });
  }, [match, matchId, teamPick?.teamId, teamState?.questionEndsAt, teamState?.status, countdownTick]);

  function scheduleQuestionAdvance(qIndex) {
    if (!teamPick?.teamId) return;
    if (advanceTimeoutRef.current) {
      clearTimeout(advanceTimeoutRef.current);
    }
    const next = Number(qIndex) + 1;
    // UI-first: render next question immediately after a tiny feedback window.
    setLocalCurrentQ((prev) => (prev == null || prev < next ? next : prev));
    advanceTimeoutRef.current = setTimeout(() => {
      advanceTimeoutRef.current = null;
      void advanceTeamQuestionIfCurrent(matchId, teamPick.teamId, qIndex).catch((err) =>
        console.error('Auto-advance failed', err)
      );
    }, NEXT_QUESTION_DELAY_MS);
  }

  function selectTeam(side) {
    if (!match) return;
    const t = side === 'A' ? match.teamA : match.teamB;
    if (!t?.id) return;
    const payload = { side, teamId: t.id, teamName: t.name };
    sessionStorage.setItem(teamStorageKey(matchId), JSON.stringify(payload));
    setTeamPick(payload);
  }

  function clearTeam() {
    sessionStorage.removeItem(teamStorageKey(matchId));
    setTeamPick(null);
    setCorrectCount(0);
    setWrongCount(0);
    setSkippedCount(0);
  }

  async function handleChoice(choiceIndex) {
    if (!teamPick?.teamId || !match || teamState?.status !== 'running') return;
    if (teamState?.status === 'finished' || teamState?.status === 'completed') return;
    if (isAnswered || choiceLockedRef.current) return;
    const qIndex = currentQ;
    const q = teamState?.questions?.[qIndex];
    const correctIdx = Number(q?.correctIndex);
    if (!Array.isArray(q?.choices) || q.choices.length < 2 || !Number.isFinite(correctIdx)) return;

    choiceLockedRef.current = true;
    setSelectedAnswer(choiceIndex);
    const ok = choiceIndex === correctIdx;
    setIsCorrect(ok);
    setIsAnswered(true);

    if (ok) {
      setCorrectCount((c) => c + 1);
    } else {
      setWrongCount((c) => c + 1);
    }

    // Keep UI responsive: do not wait for backend writes.
    scheduleQuestionAdvance(qIndex);
    void incrementMatchTeamScore(matchId, teamPick.teamId, ok ? 1 : 0, ok ? 0 : 1).catch((e) => {
      console.error('Could not save team score (did you run supabase-schema.sql?)', e);
      if (ok) {
        setCorrectCount((c) => Math.max(0, c - 1));
      } else {
        setWrongCount((c) => Math.max(0, c - 1));
      }
    });
  }

  async function handleSkip() {
    if (!teamPick?.teamId || !match || teamState?.status !== 'running') return;
    if (teamState?.status === 'finished' || teamState?.status === 'completed') return;
    if (choiceLockedRef.current || isAnswered) return;
    const qIndex = currentQ;
    const q = teamState?.questions?.[qIndex];
    if (!q) return;

    choiceLockedRef.current = true;
    setSelectedAnswer('SKIP');
    setIsCorrect(null);
    setIsAnswered(true);

    setCountdownTick((t) => t + 1);
    setSkippedCount((s) => s + 1);
    scheduleQuestionAdvance(qIndex);
    void applyPlayerTeamSkipPenaltyIfCurrent(
      matchId,
      teamPick.teamId,
      qIndex,
      SKIP_SUBTRACT_SEC
    ).catch((e) => {
      console.error('Skip countdown update failed', e);
    });
    void incrementMatchTeamSkip(matchId, teamPick.teamId, 1).catch((err) => {
      console.error('Skip stat failed', err);
      setSkippedCount((s) => Math.max(0, s - 1));
    });
  }

  if (match === undefined) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <div className="text-gray-400 text-xl">جاري تحميل المباراة...</div>
        </div>
      </div>
    );
  }

  if (match === null) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6 gap-6" dir="rtl">
        <p className="text-gray-300 text-lg text-center max-w-md">
          لم يتم العثور على هذه المباراة، أو تعذّر الاتصال بقاعدة البيانات.
        </p>
        <Link
          to="/"
          className="text-indigo-400 hover:text-indigo-300 underline text-sm font-medium"
        >
          العودة لاختيار المباراة
        </Link>
      </div>
    );
  }

  if (!teamPick) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6" dir="rtl">
        <div className="max-w-md w-full space-y-6 text-center">
          <div className="flex items-center justify-center gap-2 text-indigo-400">
            <Users size={28} />
            <h1 className="text-2xl font-black text-white">من أنتم؟</h1>
          </div>
          <p className="text-gray-500 text-sm">
            المباراة #{match.matchNumber} — اختر فريقكم قبل البدء
          </p>
          <div className="grid grid-cols-1 gap-3">
            <button
              type="button"
              onClick={() => selectTeam('A')}
              className="rounded-2xl border-2 border-blue-500/40 bg-blue-950/30 px-6 py-8 text-center transition-colors hover:bg-blue-900/40"
            >
              <div className="text-xs font-bold text-blue-300 mb-1">الفريق A</div>
              <div className="text-2xl font-black text-blue-400">{match.teamA?.name}</div>
              <div className="text-xs text-gray-500 mt-2">{match.teamA?.players?.join(' · ')}</div>
            </button>
            <button
              type="button"
              onClick={() => selectTeam('B')}
              className="rounded-2xl border-2 border-red-500/40 bg-red-950/30 px-6 py-8 text-center transition-colors hover:bg-red-900/40"
            >
              <div className="text-xs font-bold text-red-300 mb-1">الفريق B</div>
              <div className="text-2xl font-black text-red-400">{match.teamB?.name}</div>
              <div className="text-xs text-gray-500 mt-2">{match.teamB?.players?.join(' · ')}</div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const questions = teamState?.questions || [];
  const question = questions[currentQ];
  const remainingSec = getCountdownRemainingSecForTeam(match, teamPick.teamId);
  const isTeamFinished =
    teamState?.status === 'finished' ||
    teamState?.status === 'completed' ||
    remainingSec <= 0;
  const isCompleted = isTeamFinished || match.status === 'completed';
  const isRunning = teamState?.status === 'running';
  const isPending = (teamState?.status || 'pending') === 'pending';
  const isPaused = teamState?.status === 'paused';
  const progress = questions.length ? Math.min((currentQ / questions.length) * 100, 100) : 0;

  const correctIndexNum =
    question != null && question.correctIndex !== undefined && question.correctIndex !== null
      ? Number(question.correctIndex)
      : NaN;
  const hasMcq =
    question &&
    Array.isArray(question.choices) &&
    question.choices.length >= 2 &&
    Number.isFinite(correctIndexNum);

  const pickedIdx = typeof selectedAnswer === 'number' ? selectedAnswer : null;
  const showAnswerFeedback = hasMcq && isAnswered;
  const interactionLocked = isAnswered || isTeamFinished;

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col overflow-hidden" dir="rtl">
      {/* Teams Header */}
      <div className="bg-gradient-to-b from-gray-900 to-gray-950 px-6 pt-6 pb-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-wrap items-center justify-center gap-3 mb-4">
            <Zap className="text-yellow-400" size={18} />
            <span className="text-xs font-bold text-gray-400 tracking-widest uppercase">
              المباراة #{match.matchNumber}
            </span>
            <span className="text-xs bg-indigo-600/30 text-indigo-200 px-2 py-1 rounded-full">
              أنتم: {teamPick.teamName}
            </span>
            <button
              type="button"
              onClick={clearTeam}
              className="text-xs text-gray-500 hover:text-white underline"
            >
              تغيير الفريق
            </button>
            <Zap className="text-yellow-400" size={18} />
          </div>
          <div className="flex items-center justify-center gap-6 md:gap-12">
            <div
              className={`flex-1 text-center rounded-2xl px-2 py-3 transition-all ${
                teamPick.side === 'A' ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-950' : ''
              }`}
            >
              <div className="text-3xl md:text-5xl font-black text-blue-400 drop-shadow-lg">
                {match.teamA?.name}
              </div>
              <div className="text-xs md:text-sm text-gray-500 mt-1">
                {match.teamA?.players?.join(' · ')}
              </div>
            </div>
            <div className="shrink-0">
              <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-gray-800 border-2 border-gray-700 flex items-center justify-center">
                <span className="text-xl md:text-2xl font-black text-gray-400">VS</span>
              </div>
            </div>
            <div
              className={`flex-1 text-center rounded-2xl px-2 py-3 transition-all ${
                teamPick.side === 'B' ? 'ring-2 ring-red-400 ring-offset-2 ring-offset-gray-950' : ''
              }`}
            >
              <div className="text-3xl md:text-5xl font-black text-red-400 drop-shadow-lg">
                {match.teamB?.name}
              </div>
              <div className="text-xs md:text-sm text-gray-500 mt-1">
                {match.teamB?.players?.join(' · ')}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-8 gap-6">
        {(isRunning || isPaused) && (
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
            <span className="inline-flex items-center gap-1 text-green-400 bg-green-950/40 px-3 py-1 rounded-full">
              <CheckCircle2 size={16} /> صحيح: {correctCount}
            </span>
            <span className="inline-flex items-center gap-1 text-red-400 bg-red-950/40 px-3 py-1 rounded-full">
              <XCircle size={16} /> خطأ: {wrongCount}
            </span>
          </div>
        )}

        {/* Waiting State */}
        {isPending && (
          <div className="text-center space-y-6 animate-pulse">
            <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-gray-800 border-4 border-gray-700 flex items-center justify-center mx-auto">
              <Clock className="text-gray-500" size={48} />
            </div>
            <div className="text-2xl md:text-4xl font-bold text-gray-500">
              في انتظار بدء المباراة...
            </div>
            <div className="text-gray-600 text-lg">استعدوا!</div>
          </div>
        )}

        {/* Paused State */}
        {isPaused && (
          <div className="text-center space-y-6">
            <div className="text-gray-500 text-sm">الوقت المتبقي لفريقكم</div>
            <div className="text-6xl md:text-8xl font-mono font-black text-yellow-400 timer-display">
              {formatTime(remainingSec)}
            </div>
            <div className="text-2xl md:text-3xl font-bold text-yellow-400 animate-pulse">
              المباراة متوقفة مؤقتاً
            </div>
          </div>
        )}

        {/* Running State */}
        {isRunning && question && (
          <>
            <div className="text-center">
              <div className="text-gray-500 text-sm mb-1">الوقت المتبقي لفريقكم</div>
              <div className="text-6xl md:text-9xl font-mono font-black text-green-400 timer-display animate-pulse">
                {formatTime(remainingSec)}
              </div>
            </div>

            <div className="bg-gray-900 border-2 border-indigo-500/30 rounded-3xl p-6 md:p-10 max-w-3xl w-full shadow-2xl shadow-indigo-500/5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-indigo-400 text-sm font-bold">
                  السؤال {currentQ + 1} من {questions.length}
                </span>
                {question.category && (
                  <span className="bg-indigo-600/20 text-indigo-300 text-xs font-bold px-3 py-1 rounded-full">
                    {question.category}
                  </span>
                )}
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2 mb-6">
                <div
                  className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${((currentQ + 1) / questions.length) * 100}%` }}
                />
              </div>
              <h2 className="text-2xl md:text-4xl font-bold text-white text-center leading-relaxed mb-8">
                {question.question}
              </h2>

              {hasMcq ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {question.choices.map((label, idx) => {
                    let btnClass =
                      'rounded-xl border-2 px-4 py-4 text-lg font-bold text-right transition-all bg-gray-800/80 border-gray-700 text-white hover:border-indigo-500/50 disabled:opacity-60';
                    if (showAnswerFeedback) {
                      if (idx === correctIndexNum) {
                        btnClass =
                          'rounded-xl border-2 px-4 py-4 text-lg font-bold text-right bg-green-950/60 border-green-500 text-green-200';
                      } else if (idx === pickedIdx) {
                        btnClass =
                          'rounded-xl border-2 px-4 py-4 text-lg font-bold text-right bg-red-950/60 border-red-500 text-red-200';
                      } else {
                        btnClass =
                          'rounded-xl border-2 px-4 py-4 text-lg font-bold text-right bg-gray-900/50 border-gray-800 text-gray-500';
                      }
                    }
                    return (
                      <button
                        key={idx}
                        type="button"
                        disabled={interactionLocked}
                        className={btnClass}
                        onClick={() => handleChoice(idx)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-center text-gray-500 text-sm">
                  لم يُجهّز هذا السؤال كاختيار من متعدد — انتظر المشرف للانتقال للسؤال التالي.
                </p>
              )}
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  disabled={interactionLocked}
                  onClick={handleSkip}
                  className="inline-flex items-center gap-2 rounded-xl border-2 border-amber-600/50 bg-amber-950/40 px-5 py-3 text-amber-200 font-bold transition-colors hover:bg-amber-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <SkipForward size={20} />
                  تخطي (−{SKIP_SUBTRACT_SEC} ث)
                </button>
              </div>
              {hasMcq && showAnswerFeedback && (
                <p className="text-center text-indigo-200/90 text-sm mt-6 max-w-xl mx-auto leading-relaxed">
                  تم تسجيل إجابة فريقكم. الانتقال للسؤال التالي تلقائياً خلال لحظات. يمكن للمشرف التقدم أو التصحيح يدوياً
                  في أي وقت.
                </p>
              )}
              {selectedAnswer === 'SKIP' && (
                <p className="text-center text-amber-200/90 text-sm mt-4 max-w-xl mx-auto leading-relaxed">
                  تم خصم {SKIP_SUBTRACT_SEC} ثانية من الوقت المتبقي. الانتقال للسؤال التالي خلال لحظات.
                </p>
              )}
              {isTeamFinished && (
                <p className="text-center text-red-300 text-sm mt-4 max-w-xl mx-auto leading-relaxed">
                  Time is up - this team is finished.
                </p>
              )}
              {hasMcq && showAnswerFeedback && (
                <div className="mt-4 rounded-xl border border-green-800/60 bg-green-950/30 px-4 py-3 text-center">
                  <div className="text-xs text-green-400/90 mb-1">الإجابة الصحيحة</div>
                  <div className="text-green-200 font-bold text-lg">
                    {question.choices?.[correctIndexNum] ?? question.answer ?? `الخيار ${correctIndexNum + 1}`}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {isRunning && !question && (
          <div className="text-center text-gray-500 text-xl">لا توجد أسئلة</div>
        )}

        {isCompleted && (
          <div className="text-center space-y-6 max-w-2xl w-full">
            <Trophy className="mx-auto text-yellow-400 drop-shadow-lg" size={80} />
            <h2 className="text-3xl md:text-5xl font-black text-green-400">انتهت المباراة!</h2>
            <div className="text-gray-500 text-sm mb-1">مدة المباراة</div>
            <div className="text-5xl md:text-8xl font-mono font-black text-white timer-display">
              {formatTime(wallElapsedSec(teamState || match))}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-4 text-lg">
              <span className="text-green-400 font-bold">صح: {correctCount}</span>
              <span className="text-gray-600">·</span>
              <span className="text-red-400 font-bold">خطأ: {wrongCount}</span>
              <span className="text-gray-600">·</span>
              <span className="text-amber-400 font-bold">تخطي: {skippedCount}</span>
            </div>
            <div className="text-gray-400 text-sm">
              إجابات مُسجّلة: {correctCount + wrongCount} · إجمالي المحاولات (إجابة + تخطي):{' '}
              {correctCount + wrongCount + skippedCount}
            </div>
            <div className="flex items-center justify-center gap-6 text-gray-400 text-lg">
              <span>{questions.length} سؤال في المباراة</span>
            </div>
          </div>
        )}
      </div>

      {(isRunning || isPaused) && (
        <div className="bg-gray-900 border-t border-gray-800 px-6 py-3">
          <div className="max-w-3xl mx-auto">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>التقدم</span>
              <span>{currentQ}/{questions.length}</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-3">
              <div
                className="bg-gradient-to-r from-indigo-500 to-purple-500 h-3 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
