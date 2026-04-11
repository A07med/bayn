import { useState, useEffect } from 'react';
import { subscribeMatches } from '../services/supabaseService';
import { formatTime, getCountdownRemainingSec, wallElapsedSec } from '../utils';
import { Monitor, Zap } from 'lucide-react';

export default function LivePage() {
  const [matches, setMatches] = useState([]);
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = subscribeMatches((data) => {
      setMatches(data.sort((a, b) => (a.matchNumber || 0) - (b.matchNumber || 0)));
    });
    return unsub;
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, []);

  const statusColor = (status) => {
    switch (status) {
      case 'running': return 'border-blue-500 bg-blue-950/40';
      case 'completed': return 'border-green-500 bg-green-950/40';
      case 'paused': return 'border-yellow-500 bg-yellow-950/40';
      default: return 'border-gray-700 bg-gray-900';
    }
  };

  const statusBadge = (status) => {
    switch (status) {
      case 'running': return 'bg-blue-600 animate-pulse';
      case 'completed': return 'bg-green-600';
      case 'paused': return 'bg-yellow-600';
      default: return 'bg-gray-600';
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Monitor className="text-indigo-400" size={28} />
          <h1 className="text-3xl font-bold">Live Overview</h1>
          <Zap className="text-yellow-400 animate-pulse" size={20} />
        </div>

        {matches.length === 0 ? (
          <div className="text-center text-gray-500 py-20 text-lg">
            No matches created yet
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {matches.map((match) => {
              const questions = match.questions || [];
              const progress = questions.length
                ? Math.min(((match.currentQuestion || 0) / questions.length) * 100, 100)
                : 0;

              return (
                <div
                  key={match.id}
                  className={`border-2 rounded-2xl p-6 transition-all ${statusColor(match.status)}`}
                >
                  {/* Match header */}
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-bold text-gray-400">
                      MATCH #{match.matchNumber}
                    </span>
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full text-white ${statusBadge(match.status)}`}>
                      {(match.status || 'pending').toUpperCase()}
                    </span>
                  </div>

                  {/* Teams */}
                  <div className="flex items-center justify-center gap-4 mb-4">
                    <div className="text-right flex-1">
                      <div className="text-xl font-bold text-blue-400">{match.teamA?.name}</div>
                    </div>
                    <div className="text-gray-600 font-bold">VS</div>
                    <div className="text-left flex-1">
                      <div className="text-xl font-bold text-red-400">{match.teamB?.name}</div>
                    </div>
                  </div>

                  {/* Timer: per-question countdown when active; total when completed */}
                  <div className="text-center mb-3">
                    {match.status === 'running' || match.status === 'paused' ? (
                      <>
                        <div className="text-xs text-gray-500 mb-0.5">Game time left</div>
                        <div className={`font-mono text-4xl font-bold timer-display ${
                          match.status === 'running' ? 'text-green-400' : 'text-yellow-400'
                        }`}>
                          {formatTime(getCountdownRemainingSec(match))}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Match elapsed {formatTime(wallElapsedSec(match))}
                        </div>
                      </>
                    ) : (
                      <div className={`font-mono text-4xl font-bold timer-display ${
                        match.status === 'completed' ? 'text-white' : 'text-gray-500'
                      }`}>
                        {formatTime(match.status === 'completed' ? (match.elapsedTime || wallElapsedSec(match)) : 0)}
                      </div>
                    )}
                  </div>

                  {/* Progress */}
                  <div className="mb-2">
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Progress</span>
                      <span>{match.currentQuestion || 0}/{questions.length}</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div
                        className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Current question preview */}
                  {match.status === 'running' && questions[match.currentQuestion] && (
                    <div className="mt-3 bg-black/30 rounded-lg p-3">
                      <div className="text-xs text-gray-400 mb-1">Current Question:</div>
                      <div className="text-sm text-white truncate">
                        {questions[match.currentQuestion].question}
                      </div>
                    </div>
                  )}

                  {match.status === 'completed' && (
                    <div className="mt-3 text-center text-green-400 font-semibold text-sm">
                      ✓ Match Complete
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
