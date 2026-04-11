import { useState, useEffect } from 'react';
import {
  subscribeMatches,
  subscribeTeams,
  subscribeAllMatchTeamResults,
} from '../services/supabaseService';
import { formatTime } from '../utils';
import { Trophy, Clock, AlertTriangle, Medal, Target } from 'lucide-react';

export default function ResultsPage() {
  const [matches, setMatches] = useState([]);
  const [teams, setTeams] = useState([]);
  const [teamResults, setTeamResults] = useState([]);

  useEffect(() => {
    const unsubMatches = subscribeMatches((data) => {
      setMatches(data.sort((a, b) => (a.matchNumber || 0) - (b.matchNumber || 0)));
    });
    const unsubTeams = subscribeTeams(setTeams);
    const unsubScores = subscribeAllMatchTeamResults(setTeamResults);
    return () => {
      unsubMatches();
      unsubTeams();
      unsubScores();
    };
  }, []);

  const teamNameById = (id) => teams.find((t) => t.id === id)?.name || id?.slice(0, 8) || '—';

  const completedMatches = matches.filter((m) => m.status === 'completed');

  const rankColors = ['text-yellow-400', 'text-gray-300', 'text-amber-600'];
  const rankIcons = [
    <Medal key={0} className="text-yellow-400" size={24} />,
    <Medal key={1} className="text-gray-300" size={24} />,
    <Medal key={2} className="text-amber-600" size={24} />,
  ];

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="flex items-center gap-3 mb-6">
        <Trophy className="text-yellow-400" size={28} />
        <h1 className="text-3xl font-bold">Results</h1>
      </div>

      {/* Match Results */}
      <h2 className="text-lg font-semibold text-gray-400 mb-3">Match Results</h2>
      {matches.length === 0 ? (
        <p className="text-gray-500 text-center py-10">No matches yet</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {matches.map((match) => {
            const isComplete = match.status === 'completed';
            return (
              <div
                key={match.id}
                className={`border rounded-2xl p-6 ${
                  isComplete
                    ? 'border-green-800 bg-green-950/20'
                    : 'border-gray-800 bg-gray-900'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-gray-400">
                    Match #{match.matchNumber}
                  </span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    isComplete ? 'bg-green-900 text-green-400' : 'bg-gray-800 text-gray-400'
                  }`}>
                    {(match.status || 'pending').toUpperCase()}
                  </span>
                </div>

                <div className="flex items-center justify-center gap-4 mb-4">
                  <span className="text-lg font-bold text-blue-400">{match.teamA?.name}</span>
                  <span className="text-gray-600 font-bold">vs</span>
                  <span className="text-lg font-bold text-red-400">{match.teamB?.name}</span>
                </div>

                {isComplete ? (
                  <div className="text-center space-y-2">
                    <div className="flex items-center justify-center gap-2 text-white">
                      <Clock size={18} />
                      <span className="font-mono text-3xl font-bold">
                        {formatTime(match.elapsedTime || 0)}
                      </span>
                    </div>
                    {(match.penalties || 0) > 0 && (
                      <div className="flex items-center justify-center gap-1 text-yellow-400 text-sm">
                        <AlertTriangle size={14} />
                        +{match.penalties}s penalties included
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center text-gray-500 text-sm">
                    {match.status === 'running' ? 'Match in progress...' : 'Waiting to start'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {teamResults.length > 0 && (
        <>
          <h2 className="text-lg font-semibold text-gray-400 mb-3 flex items-center gap-2">
            <Target size={18} />
            Team scores (MCQ)
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden mb-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="text-left p-3">Match</th>
                  <th className="text-left p-3">Team</th>
                  <th className="text-right p-3 text-green-400">Correct</th>
                  <th className="text-right p-3 text-red-400">Wrong</th>
                  <th className="text-right p-3 text-amber-200">Skipped</th>
                  <th className="text-right p-3 text-gray-400">Answered</th>
                  <th className="text-right p-3 text-gray-400">Attempted</th>
                </tr>
              </thead>
              <tbody>
                {teamResults
                  .slice()
                  .sort((a, b) => {
                    const ma = matches.find((m) => m.id === a.matchId)?.matchNumber ?? 0;
                    const mb = matches.find((m) => m.id === b.matchId)?.matchNumber ?? 0;
                    return ma - mb || teamNameById(a.teamId).localeCompare(teamNameById(b.teamId));
                  })
                  .map((row) => (
                    <tr key={row.id} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                      <td className="p-3 text-gray-500">
                        #{matches.find((m) => m.id === row.matchId)?.matchNumber ?? '—'}
                      </td>
                      <td className="p-3 font-medium text-white">{teamNameById(row.teamId)}</td>
                      <td className="p-3 text-right font-mono">{row.correctCount}</td>
                      <td className="p-3 text-right font-mono">{row.wrongCount}</td>
                      <td className="p-3 text-right font-mono">{row.skippedCount ?? 0}</td>
                      <td className="p-3 text-right font-mono text-gray-300">
                        {(row.correctCount ?? 0) + (row.wrongCount ?? 0)}
                      </td>
                      <td className="p-3 text-right font-mono text-gray-300">
                        {(row.correctCount ?? 0) + (row.wrongCount ?? 0) + (row.skippedCount ?? 0)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Leaderboard */}
      {completedMatches.length > 0 && (
        <>
          <h2 className="text-lg font-semibold text-gray-400 mb-3">
            Completed Matches Leaderboard
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-sm">
                  <th className="text-left p-4">Rank</th>
                  <th className="text-left p-4">Match</th>
                  <th className="text-left p-4">Teams</th>
                  <th className="text-right p-4">Time</th>
                  <th className="text-right p-4">Penalties</th>
                </tr>
              </thead>
              <tbody>
                {completedMatches
                  .sort((a, b) => (a.elapsedTime || 0) - (b.elapsedTime || 0))
                  .map((match, i) => (
                    <tr key={match.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {i < 3 ? rankIcons[i] : (
                            <span className="text-gray-500 w-6 text-center font-bold">
                              {i + 1}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-gray-400">#{match.matchNumber}</td>
                      <td className="p-4">
                        <span className="text-blue-400 font-semibold">{match.teamA?.name}</span>
                        <span className="text-gray-600 mx-2">vs</span>
                        <span className="text-red-400 font-semibold">{match.teamB?.name}</span>
                      </td>
                      <td className={`p-4 text-right font-mono font-bold text-lg ${
                        i < 3 ? rankColors[i] : 'text-white'
                      }`}>
                        {formatTime(match.elapsedTime || 0)}
                      </td>
                      <td className="p-4 text-right text-yellow-400 text-sm">
                        {(match.penalties || 0) > 0 ? `+${match.penalties}s` : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
