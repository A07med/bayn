import { useState, useEffect, useCallback } from 'react';
import {
  getTeams, addTeam, updateTeam, deleteTeam,
  getMatches, createMatch, deleteMatch, updateMatch,
  saveQuestions, getQuestions,
  subscribeTeams, subscribeMatches, subscribeQuestions,
  subscribeAllMatchTeamResults,
  clearMatchTeamResultsForMatches,
} from '../services/supabaseService';
import { distributeQuestions, enrichQuestionWithMcq } from '../utils';
import { Plus, Trash2, Upload, RefreshCw, Users, Swords, HelpCircle, Play } from 'lucide-react';

export default function AdminPage() {
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('teams');
  const [matchTeamResults, setMatchTeamResults] = useState([]);

  const [teamForm, setTeamForm] = useState({ name: '', player1: '', player2: '', player3: '' });
  const [editingTeam, setEditingTeam] = useState(null);
  const [matchForm, setMatchForm] = useState({ teamAId: '', teamBId: '', gameDurationMinutes: 15 });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [t, m, q] = await Promise.all([getTeams(), getMatches(), getQuestions()]);
      setTeams(t);
      setMatches(m);
      setQuestions(q);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubs = [];

    queueMicrotask(() => {
      if (!cancelled) loadData();
    });

    unsubs.push(
      subscribeTeams((t) => {
        if (!cancelled) setTeams(t);
      })
    );
    unsubs.push(
      subscribeMatches((m) => {
        if (!cancelled) setMatches(m);
      })
    );
    unsubs.push(
      subscribeQuestions((q) => {
        if (!cancelled) setQuestions(q);
      })
    );
    unsubs.push(
      subscribeAllMatchTeamResults((rows) => {
        if (!cancelled) setMatchTeamResults(rows);
      })
    );

    return () => {
      cancelled = true;
      unsubs.forEach((fn) => fn());
    };
  }, [loadData]);

  // ── Team CRUD ──

  async function handleAddTeam(e) {
    e.preventDefault();
    const data = {
      name: teamForm.name,
      players: [teamForm.player1, teamForm.player2, teamForm.player3],
    };

    if (editingTeam) {
      await updateTeam(editingTeam, data);
      setEditingTeam(null);
    } else {
      await addTeam(data);
    }
    setTeamForm({ name: '', player1: '', player2: '', player3: '' });
    await loadData();
  }

  function startEditTeam(team) {
    setEditingTeam(team.id);
    setTeamForm({
      name: team.name,
      player1: team.players[0] || '',
      player2: team.players[1] || '',
      player3: team.players[2] || '',
    });
  }

  async function handleDeleteTeam(id) {
    if (!confirm('Delete this team?')) return;
    await deleteTeam(id);
    await loadData();
  }

  // ── Match CRUD ──

  async function handleCreateMatch(e) {
    e.preventDefault();
    if (matchForm.teamAId === matchForm.teamBId) return alert('Select two different teams');
    const teamA = teams.find((t) => t.id === matchForm.teamAId);
    const teamB = teams.find((t) => t.id === matchForm.teamBId);
    if (!teamA || !teamB) return;

    const mins = Math.max(1, Math.min(24 * 60, Number(matchForm.gameDurationMinutes) || 15));
    await createMatch({
      teamA: { id: teamA.id, name: teamA.name, players: teamA.players },
      teamB: { id: teamB.id, name: teamB.name, players: teamB.players },
      questions: [],
      currentQuestion: 0,
      status: 'pending',
      elapsedTime: 0,
      penalties: 0,
      matchNumber: matches.length + 1,
      gameDurationMinutes: mins,
    });
    setMatchForm({ teamAId: '', teamBId: '', gameDurationMinutes: 15 });
    await loadData();
  }

  async function handleDeleteMatch(id) {
    if (!confirm('Delete this match?')) return;
    await deleteMatch(id);
    await loadData();
  }

  // ── Questions ──

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return alert('JSON must be an array');
      await saveQuestions(parsed);
      setQuestions(parsed);
    } catch {
      alert('Invalid JSON file');
    }
  }

  async function handleDistributeQuestions() {
    if (questions.length === 0) return alert('No questions loaded');
    if (matches.length === 0) return alert('No matches created');

    const answerPool = questions.map((q) => q.answer);
    const enriched = questions.map((q) => enrichQuestionWithMcq(q, answerPool));
    const groups = distributeQuestions(enriched, matches.length);
    for (let i = 0; i < matches.length; i++) {
      await updateMatch(matches[i].id, { questions: groups[i], currentQuestion: 0 });
    }
    alert(`Distributed ${questions.length} questions across ${matches.length} matches`);
    await loadData();
  }

  async function handleResetAllMatches() {
    if (!confirm('Reset ALL matches to pending state?')) return;
    await clearMatchTeamResultsForMatches(matches.map((m) => m.id));
    for (const m of matches) {
      await updateMatch(m.id, {
        status: 'pending',
        currentQuestion: 0,
        elapsedTime: 0,
        penalties: 0,
        questionEndsAt: null,
        pausedRemainingSec: null,
        matchStartedAt: null,
      });
    }
    await loadData();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="animate-spin text-indigo-400" size={32} />
      </div>
    );
  }

  const tabs = [
    { key: 'teams', label: 'Teams', icon: Users, count: teams.length },
    { key: 'matches', label: 'Matches', icon: Swords, count: matches.length },
    { key: 'questions', label: 'Questions', icon: HelpCircle, count: questions.length },
  ];

  return (
    <div className="max-w-5xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Admin Dashboard</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {tabs.map((tabItem) => {
          const Icon = tabItem.icon;
          return (
            <button
              key={tabItem.key}
              onClick={() => setTab(tabItem.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === tabItem.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              <Icon size={16} />
              {tabItem.label}
              <span className="bg-black/30 px-2 py-0.5 rounded-full text-xs">{tabItem.count}</span>
            </button>
          );
        })}
      </div>

      {/* ── Teams Tab ── */}
      {tab === 'teams' && (
        <div className="space-y-4">
          <form onSubmit={handleAddTeam} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h2 className="text-lg font-semibold mb-3">
              {editingTeam ? 'Edit Team' : 'Add New Team'}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                placeholder="Team Name"
                value={teamForm.name}
                onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })}
                required
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
              <input
                placeholder="Player 1"
                value={teamForm.player1}
                onChange={(e) => setTeamForm({ ...teamForm, player1: e.target.value })}
                required
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
              <input
                placeholder="Player 2"
                value={teamForm.player2}
                onChange={(e) => setTeamForm({ ...teamForm, player2: e.target.value })}
                required
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
              <input
                placeholder="Player 3"
                value={teamForm.player3}
                onChange={(e) => setTeamForm({ ...teamForm, player3: e.target.value })}
                required
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex gap-2 mt-3">
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1"
              >
                <Plus size={16} />
                {editingTeam ? 'Update Team' : 'Add Team'}
              </button>
              {editingTeam && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingTeam(null);
                    setTeamForm({ name: '', player1: '', player2: '', player3: '' });
                  }}
                  className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {teams.map((team) => (
              <div key={team.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-lg">{team.name}</h3>
                  <div className="flex gap-1">
                    <button
                      onClick={() => startEditTeam(team)}
                      className="text-gray-400 hover:text-indigo-400 p-1 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteTeam(team.id)}
                      className="text-gray-400 hover:text-red-400 p-1 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="text-sm text-gray-400 space-y-0.5">
                  {team.players.map((p, i) => (
                    <div key={i}>
                      <span className="text-gray-600">P{i + 1}:</span> {p}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {teams.length === 0 && (
            <p className="text-center text-gray-500 py-8">No teams added yet</p>
          )}
        </div>
      )}

      {/* ── Matches Tab ── */}
      {tab === 'matches' && (
        <div className="space-y-4">
          <form onSubmit={handleCreateMatch} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h2 className="text-lg font-semibold mb-3">Create Match</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select
                value={matchForm.teamAId}
                onChange={(e) => setMatchForm({ ...matchForm, teamAId: e.target.value })}
                required
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">Select Team A</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <select
                value={matchForm.teamBId}
                onChange={(e) => setMatchForm({ ...matchForm, teamBId: e.target.value })}
                required
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">Select Team B</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <label className="sm:col-span-2 flex flex-col gap-1 text-sm text-gray-400">
                Game duration (minutes)
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={matchForm.gameDurationMinutes}
                  onChange={(e) =>
                    setMatchForm({
                      ...matchForm,
                      gameDurationMinutes: Number(e.target.value) || 15,
                    })
                  }
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 max-w-xs"
                />
              </label>
            </div>
            <button
              type="submit"
              className="mt-3 bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1"
            >
              <Plus size={16} /> Create Match
            </button>
          </form>

          <div className="flex gap-2">
            <button
              onClick={handleResetAllMatches}
              className="bg-yellow-600 hover:bg-yellow-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1"
            >
              <RefreshCw size={16} /> Reset All Matches
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {matches.map((match) => (
              <div key={match.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs bg-gray-800 px-2 py-0.5 rounded-full text-gray-400">
                    Match #{match.matchNumber}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      match.status === 'completed' ? 'bg-green-900 text-green-400' :
                      match.status === 'running' ? 'bg-blue-900 text-blue-400' :
                      'bg-gray-800 text-gray-400'
                    }`}>
                      {match.status}
                    </span>
                    <button
                      onClick={() => handleDeleteMatch(match.id)}
                      className="text-gray-400 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="text-center py-2">
                  <span className="text-white font-bold">{match.teamA?.name}</span>
                  <span className="text-gray-500 mx-2">vs</span>
                  <span className="text-white font-bold">{match.teamB?.name}</span>
                </div>
                <div className="text-xs text-gray-500 text-center">
                  {match.questions?.length || 0} questions · {match.gameDurationMinutes ?? 15} min game
                </div>
                {match.status === 'completed' && (
                  <div className="mt-3 space-y-2 text-xs">
                    <div className="text-gray-500 font-semibold uppercase tracking-wide">Final team stats</div>
                    {[match.teamA, match.teamB].map((t) => {
                      if (!t?.id) return null;
                      const r = matchTeamResults.find(
                        (x) => x.matchId === match.id && x.teamId === t.id
                      );
                      const c = r?.correctCount ?? 0;
                      const w = r?.wrongCount ?? 0;
                      const s = r?.skippedCount ?? 0;
                      const answered = c + w;
                      const attempted = answered + s;
                      const isA = t.id === match.teamA?.id;
                      return (
                        <div
                          key={t.id}
                          className={`rounded-lg px-3 py-2 border ${
                            isA ? 'border-blue-800/60 bg-blue-950/20' : 'border-red-800/60 bg-red-950/20'
                          }`}
                        >
                          <div className={`font-bold ${isA ? 'text-blue-300' : 'text-red-300'}`}>
                            {t.name}
                          </div>
                          <div className="text-gray-400 mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                            <span>Answered</span>
                            <span className="text-right text-gray-200">{answered}</span>
                            <span className="text-green-400">Correct</span>
                            <span className="text-right">{c}</span>
                            <span className="text-red-400">Wrong</span>
                            <span className="text-right">{w}</span>
                            <span className="text-amber-200">Skipped</span>
                            <span className="text-right">{s}</span>
                            <span className="text-gray-500 col-span-2 pt-1 border-t border-gray-700 mt-1">
                              Total attempted: {attempted}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <a
                    href={`/admin/match/${match.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg text-sm text-white transition-colors"
                  >
                    <Play size={14} className="inline mr-1" />
                    Control
                  </a>
                  <a
                    href={`/play/${match.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg text-sm text-green-400 transition-colors"
                  >
                    <Play size={14} className="inline mr-1" />
                    Player View
                  </a>
                </div>
              </div>
            ))}
          </div>
          {matches.length === 0 && (
            <p className="text-center text-gray-500 py-8">No matches created yet</p>
          )}
        </div>
      )}

      {/* ── Questions Tab ── */}
      {tab === 'questions' && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h2 className="text-lg font-semibold mb-3">Upload Questions</h2>
            <p className="text-sm text-gray-400 mb-3">
              Upload JSON array. Plain format: <code className="text-indigo-400">[{`{ "question", "answer", "category?" }`}]</code>
              — or include MCQ: <code className="text-indigo-400">choices</code> +{' '}
              <code className="text-indigo-400">correctIndex</code>. Saving here updates the <strong>question bank</strong> in Supabase only.
            </p>
            <div className="text-sm text-amber-200/90 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-3">
              <strong className="text-amber-100">Players use each match’s copied questions,</strong> not this list directly. After you load or
              upload JSON, click <strong>Shuffle &amp; Distribute to Matches</strong> so every match gets the latest texts (including{' '}
              <code className="text-amber-50">choices</code> / <code className="text-amber-50">correctIndex</code>). Otherwise screens keep the old
              snapshot from the last distribute.
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer flex items-center gap-1">
                <Upload size={16} /> Upload JSON
                <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
              </label>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch('/sample-questions.json', { cache: 'no-store' });
                    if (!res.ok) throw new Error(String(res.status));
                    const data = await res.json();
                    await saveQuestions(data);
                    setQuestions(data);
                    alert(
                      'Sample bank loaded into Supabase. Click “Shuffle & Distribute to Matches” so player/admin match views use the new MCQs.'
                    );
                  } catch (e) {
                    console.error(e);
                    alert('Failed to load sample questions (check console & Supabase settings row permissions).');
                  }
                }}
                className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Load Sample Questions
              </button>
              <button
                onClick={handleDistributeQuestions}
                className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1"
              >
                <RefreshCw size={16} /> Shuffle & Distribute to Matches
              </button>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="font-semibold mb-3">
              Loaded Questions ({questions.length})
            </h3>
            {questions.length === 0 ? (
              <p className="text-gray-500 text-sm">No questions loaded</p>
            ) : (
              <div className="max-h-96 overflow-y-auto space-y-2">
                {questions.map((q, i) => (
                  <div key={i} className="bg-gray-800 rounded-lg p-3 text-sm">
                    <div className="flex gap-2">
                      <span className="text-gray-500 shrink-0">#{i + 1}</span>
                      <div>
                        <div className="text-white">{q.question}</div>
                        <div className="text-green-400 mt-0.5">
                          → {q.answer}
                          {Array.isArray(q.choices) && q.choices.length ? (
                            <span className="text-indigo-300 mr-2"> · MCQ ({q.choices.length})</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
